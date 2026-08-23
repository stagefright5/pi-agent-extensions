/**
 * Prompt Truly Mine
 *
 * Replaces pi's prompt editor with a CustomEditor subclass that adds:
 *   - Ctrl+Z and pi's configured tui.editor.undo key: undo
 *   - Ctrl+Shift+Z and Ctrl+Y: redo
 *   - Inline skill/prompt-template autocomplete after "/"
 *   - Composable skill and prompt-template context expansion
 *
 * The editor still delegates to CustomEditor for pi app shortcuts,
 * autocomplete, prompt history, paste handling, image paste, etc.
 */

import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
	CustomEditor,
	parseFrontmatter,
	stripFrontmatter,
	type EditorFactory,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type AutocompleteItem,
	type AutocompleteProvider,
	type EditorOptions,
	type EditorTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	applyComposableCompletion,
	buildContextCompletionItems,
	decodeComposableCompletionPrefix,
	encodeComposableCompletionPrefix,
	extractReferencedCommands,
	findSlashCompletionContext,
	formatContextBundle,
	isExpandedContextBundle,
	type ComposableCommand,
	type LoadedContextResource,
} from "./inline-context.ts";

type Snapshot = {
	text: string;
	cursor: { line: number; col: number };
};

const MAX_HISTORY = 200;
const REDO_KEYS = [Key.ctrlShift("z"), Key.ctrl("y")] as const;

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return a.text === b.text && a.cursor.line === b.cursor.line && a.cursor.col === b.cursor.col;
}

function snapshotTextChanged(a: Snapshot, b: Snapshot): boolean {
	return a.text !== b.text;
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
	return {
		text: snapshot.text,
		cursor: { line: snapshot.cursor.line, col: snapshot.cursor.col },
	};
}

const MODIFY_OTHER_KEYS_PRINTABLE_REGEX = /^\x1b\[27;(\d+);(\d+)~$/;
const SHIFT_MODIFIER = 1;
const LOCK_MODIFIERS = 64 + 128;

function decodeModifyOtherKeysPrintable(data: string): string | undefined {
	const match = data.match(MODIFY_OTHER_KEYS_PRINTABLE_REGEX);
	if (!match) return undefined;

	const modifier = Number.parseInt(match[1]!, 10) - 1;
	const codepoint = Number.parseInt(match[2]!, 10);
	if ((modifier & ~LOCK_MODIFIERS & ~SHIFT_MODIFIER) !== 0) return undefined;
	if (!Number.isFinite(codepoint) || codepoint < 32 || codepoint === 127) return undefined;

	try {
		return String.fromCodePoint(codepoint);
	} catch {
		return undefined;
	}
}

function decodePrintableInput(data: string): string | undefined {
	if (!data.includes("\x1b") && [...data].length === 1) {
		const codepoint = data.codePointAt(0);
		if (codepoint !== undefined && codepoint >= 32 && codepoint !== 127) return data;
	}

	return decodeKittyPrintable(data) ?? decodeModifyOtherKeysPrintable(data);
}

type EditorInternals = {
	state?: { lines: string[]; cursorLine: number; cursorCol: number };
	scrollOffset?: number;
	historyIndex?: number;
	lastAction?: unknown;
	preferredVisualCol?: number | null;
	snappedFromCursorCol?: number | null;
	undoStack?: { clear?: () => void };
	cancelAutocomplete?: () => void;
	onChange?: (text: string) => void;
	tui?: { requestRender?: () => void };
	autocompletePrefix?: string;
	autocompleteList?: { getSelectedItem?: () => AutocompleteItem | undefined };
	requestAutocomplete?: (options: { force: boolean; explicitTab: boolean }) => void;
};

/**
 * Restore text and cursor as one snapshot.
 *
 * pi-tui currently exposes `getCursor()` but no public `setCursor()` or
 * complete editor snapshot-restore API. To preserve cursor-restoring undo/redo,
 * this shim keeps all private Editor-state access in one defensive place. If a
 * future pi-tui release changes these internals, callers fall back to public
 * `setText()` behavior instead of throwing from input handling.
 */
function restoreEditorSnapshotViaInternalState(editor: CustomEditor, snapshot: Snapshot): boolean {
	try {
		const internal = editor as unknown as EditorInternals;
		const state = internal.state;
		if (!state || !Array.isArray(state.lines)) return false;
		if (typeof state.cursorLine !== "number" || typeof state.cursorCol !== "number") return false;

		internal.cancelAutocomplete?.();

		const lines = snapshot.text.split("\n");
		state.lines = lines.length > 0 ? lines : [""];
		state.cursorLine = Math.max(0, Math.min(snapshot.cursor.line, state.lines.length - 1));
		const currentLine = state.lines[state.cursorLine] ?? "";
		state.cursorCol = Math.max(0, Math.min(snapshot.cursor.col, currentLine.length));

		internal.historyIndex = -1;
		internal.lastAction = null;
		internal.preferredVisualCol = null;
		internal.snappedFromCursorCol = null;
		internal.scrollOffset = 0;
		// Keep pi's built-in one-way undo stack from diverging from this
		// extension's undo/redo history after a manual snapshot restore.
		internal.undoStack?.clear?.();

		internal.onChange?.(editor.getText());
		internal.tui?.requestRender?.();
		return true;
	} catch {
		return false;
	}
}

function requestInlineContextAutocomplete(editor: CustomEditor): boolean {
	try {
		if (editor.isShowingAutocomplete()) return false;
		const internal = editor as unknown as EditorInternals;
		if (!internal.state || typeof internal.requestAutocomplete !== "function") return false;
		const context = findSlashCompletionContext(
			internal.state.lines,
			internal.state.cursorLine,
			internal.state.cursorCol,
		);
		if (!context || context.isInitialCommand) return false;
		internal.requestAutocomplete({ force: false, explicitTab: false });
		return true;
	} catch {
		return false;
	}
}

function makeSelectedContextCompletionComposable(
	editor: CustomEditor,
	isComposableCommand: (value: string) => boolean,
): boolean {
	try {
		const internal = editor as unknown as EditorInternals;
		const prefix = internal.autocompletePrefix;
		if (!prefix?.startsWith("/")) return false;
		const selected = internal.autocompleteList?.getSelectedItem?.();
		if (!selected || !isComposableCommand(selected.value)) return false;
		internal.autocompletePrefix = encodeComposableCompletionPrefix(prefix);
		return true;
	} catch {
		return false;
	}
}

function getComposableCommands(pi: ExtensionAPI): ComposableCommand[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill" || command.source === "prompt")
		.map((command) => ({
			name: command.name,
			description: command.description,
			source: command.source as "skill" | "prompt",
			path: command.sourceInfo.path,
		}));
}

function createInlineContextAutocompleteProvider(
	current: AutocompleteProvider,
	getCommands: () => ComposableCommand[],
): AutocompleteProvider {
	return {
		...(current.triggerCharacters ? { triggerCharacters: current.triggerCharacters } : {}),

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			// Explicit Tab retains Pi's normal forced file/path completion.
			if (options.force) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const context = findSlashCompletionContext(lines, cursorLine, cursorCol);
			if (!context || context.isInitialCommand) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const items = buildContextCompletionItems(getCommands(), context.query);
			if (items.length === 0) return null;
			return {
				items,
				prefix: encodeComposableCompletionPrefix(context.prefix),
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (decodeComposableCompletionPrefix(prefix) !== null) {
				return applyComposableCompletion(lines, cursorLine, cursorCol, item.value, prefix);
			}
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

async function loadContextResources(
	commands: readonly ComposableCommand[],
	ctx: ExtensionContext,
): Promise<LoadedContextResource[]> {
	const loaded: LoadedContextResource[] = [];

	for (const command of commands) {
		try {
			const raw = await readFile(command.path, "utf8");
			const body = command.source === "skill" ? stripFrontmatter(raw).trim() : parseFrontmatter(raw).body.trim();
			loaded.push({
				...command,
				body,
				baseDir: dirname(command.path),
			});
		} catch (error) {
			if (ctx.hasUI) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not load /${command.name}: ${message}`, "warning");
			}
		}
	}

	return loaded;
}

class UndoRedoEditor extends CustomEditor {
	private undoHistory: Snapshot[] = [];
	private redoHistory: Snapshot[] = [];
	private lastEditWasTyping = false;
	private readonly appKeybindings: KeybindingsManager;
	private readonly isComposableCommand: (value: string) => boolean;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		isComposableCommand: (value: string) => boolean,
		options?: EditorOptions,
	) {
		super(tui, theme, keybindings, options);
		this.appKeybindings = keybindings;
		this.isComposableCommand = isComposableCommand;
	}

	override handleInput(data: string): void {
		if (this.isUndoKey(data)) {
			this.undoPromptEdit();
			return;
		}

		if (this.isRedoKey(data)) {
			this.redoPromptEdit();
			return;
		}

		if (this.appKeybindings.matches(data, "tui.select.confirm")) {
			makeSelectedContextCompletionComposable(this, this.isComposableCommand);
		}

		const before = this.currentSnapshot();
		const wasPlainPrintable = this.isPlainPrintable(data);

		super.handleInput(data);

		const after = this.currentSnapshot();
		if (!sameSnapshot(before, after)) {
			requestInlineContextAutocomplete(this);
		}
		if (sameSnapshot(before, after)) return;

		// Do not let a submitted prompt become undoable in the now-empty editor.
		if (before.text.length > 0 && after.text.length === 0 && this.isSubmitKey(data)) {
			this.clearPromptEditHistory();
			return;
		}

		if (snapshotTextChanged(before, after)) {
			const coalesceWithPreviousTyping =
				wasPlainPrintable && this.lastEditWasTyping && !/^\s$/.test(decodePrintableInput(data) ?? data);

			if (!coalesceWithPreviousTyping) {
				this.pushUndo(before);
			}

			this.redoHistory = [];
			this.lastEditWasTyping = wasPlainPrintable;
		} else {
			// Cursor-only movement should break typing coalescing so the next edit
			// gets its own undo boundary at the new cursor location.
			this.lastEditWasTyping = false;
		}
	}

	override setText(text: string): void {
		const before = this.currentSnapshot();
		super.setText(text);
		const after = this.currentSnapshot();
		if (!sameSnapshot(before, after) && snapshotTextChanged(before, after)) {
			this.pushUndo(before);
			this.redoHistory = [];
			this.lastEditWasTyping = false;
		}
	}

	override insertTextAtCursor(text: string): void {
		const before = this.currentSnapshot();
		super.insertTextAtCursor(text);
		const after = this.currentSnapshot();
		if (!sameSnapshot(before, after) && snapshotTextChanged(before, after)) {
			this.pushUndo(before);
			this.redoHistory = [];
			this.lastEditWasTyping = false;
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		const hints: string[] = [];
		if (this.undoHistory.length > 0) hints.push("↶ Ctrl+Z undo");
		if (this.redoHistory.length > 0) hints.push("↷ Ctrl+Shift+Z redo");
		if (hints.length === 0) return lines;

		const label = ` ${hints.join("  ")} `;
		const last = lines.length - 1;
		if (visibleWidth(lines[last]!) >= label.length + 4) {
			lines[last] = truncateToWidth(lines[last]!, Math.max(0, width - label.length), "") + label;
		}
		return lines;
	}

	private currentSnapshot(): Snapshot {
		return {
			text: this.getText(),
			cursor: this.getCursor(),
		};
	}

	private pushUndo(snapshot: Snapshot): void {
		this.undoHistory.push(cloneSnapshot(snapshot));
		if (this.undoHistory.length > MAX_HISTORY) {
			this.undoHistory.splice(0, this.undoHistory.length - MAX_HISTORY);
		}
	}

	private pushRedo(snapshot: Snapshot): void {
		this.redoHistory.push(cloneSnapshot(snapshot));
		if (this.redoHistory.length > MAX_HISTORY) {
			this.redoHistory.splice(0, this.redoHistory.length - MAX_HISTORY);
		}
	}

	private undoPromptEdit(): void {
		const snapshot = this.undoHistory.pop();
		if (!snapshot) return;
		this.pushRedo(this.currentSnapshot());
		this.restoreSnapshot(snapshot);
		this.lastEditWasTyping = false;
	}

	private redoPromptEdit(): void {
		const snapshot = this.redoHistory.pop();
		if (!snapshot) return;
		this.pushUndo(this.currentSnapshot());
		this.restoreSnapshot(snapshot);
		this.lastEditWasTyping = false;
	}

	private restoreSnapshot(snapshot: Snapshot): void {
		if (restoreEditorSnapshotViaInternalState(this, snapshot)) return;

		// Defensive fallback for future pi-tui internals: text is restored through
		// the public API, but cursor restoration may degrade to pi-tui defaults.
		super.setText(snapshot.text);
	}

	private clearPromptEditHistory(): void {
		this.undoHistory = [];
		this.redoHistory = [];
		this.lastEditWasTyping = false;
	}

	private isUndoKey(data: string): boolean {
		return this.appKeybindings.matches(data, "tui.editor.undo") || matchesKey(data, Key.ctrl("z"));
	}

	private isRedoKey(data: string): boolean {
		return REDO_KEYS.some((key) => matchesKey(data, key));
	}

	private isSubmitKey(data: string): boolean {
		return this.appKeybindings.matches(data, "tui.input.submit");
	}

	private isPlainPrintable(data: string): boolean {
		return decodePrintableInput(data) !== undefined;
	}
}

export default function promptTrulyMineExtension(pi: ExtensionAPI): void {
	let previousEditorFactory: EditorFactory | undefined;
	let installedEditorFactory: EditorFactory | undefined;

	pi.on("input", async (event, ctx) => {
		if (isExpandedContextBundle(event.text)) return { action: "continue" as const };

		const availableCommands = getComposableCommands(pi);
		const referencedCommands = extractReferencedCommands(event.text, availableCommands);
		if (referencedCommands.length === 0) return { action: "continue" as const };

		const resources = await loadContextResources(referencedCommands, ctx);
		if (resources.length === 0) return { action: "continue" as const };

		return {
			action: "transform" as const,
			text: formatContextBundle(event.text, resources),
		};
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.addAutocompleteProvider((current) =>
			createInlineContextAutocompleteProvider(current, () => getComposableCommands(pi)),
		);
		const isComposableCommand = (value: string) =>
			getComposableCommands(pi).some((command) => command.name === value);

		previousEditorFactory = ctx.ui.getEditorComponent();
		installedEditorFactory = (tui, theme, keybindings) =>
			new UndoRedoEditor(tui, theme, keybindings, isComposableCommand);
		ctx.ui.setEditorComponent(installedEditorFactory);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (installedEditorFactory && ctx.ui.getEditorComponent() === installedEditorFactory) {
			ctx.ui.setEditorComponent(previousEditorFactory);
		}
		previousEditorFactory = undefined;
		installedEditorFactory = undefined;
	});
}
