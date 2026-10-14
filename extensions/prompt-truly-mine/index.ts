/**
 * Prompt Truly Mine
 *
 * Replaces pi's prompt editor with a CustomEditor subclass that adds:
 *   - Ctrl+Z and pi's configured tui.editor.undo key: undo
 *   - Ctrl+Shift+Z and Ctrl+Y: redo
 *   - Inline extension/skill/prompt-template autocomplete after "/"
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
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	CURSOR_MARKER,
	renderFakeCursor,
	Key,
	matchesKey,
	truncateToWidth,
	type TuiMouseEvent,
	type TuiMouseEventResult,
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
	promoteInlineExtensionCommand,
	type ComposableCommand,
	type InlineCommand,
	type LoadedContextResource,
} from "./inline-context.ts";

import { composerHeader, readableScrollChrome } from "./editor-chrome.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

import {
	captureEditorSnapshot,
	makeSelectedContextCompletionComposable,
	requestInlineContextAutocomplete,
	restoreEditorSnapshotViaInternalState,
	restorePasteData,
	type Snapshot,
} from "./editor-compat.ts";

const MAX_HISTORY = 200;
const REDO_KEYS = [Key.ctrlShift("z"), Key.ctrl("y")] as const;

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return !snapshotTextChanged(a, b) && a.cursor.line === b.cursor.line && a.cursor.col === b.cursor.col;
}

function snapshotTextChanged(a: Snapshot, b: Snapshot): boolean {
	return a.text !== b.text || a.expandedText !== b.expandedText;
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
	return {
		...snapshot,
		cursor: { line: snapshot.cursor.line, col: snapshot.cursor.col },
	};
}

const MODIFY_OTHER_KEYS_PRINTABLE_REGEX = /^\[27;(\d+);(\d+)~$/;
const SHIFT_MODIFIER = 1;
const LOCK_MODIFIERS = 64 + 128;

function decodeModifyOtherKeysPrintable(data: string): string | undefined {
	if (!data.startsWith("\x1b")) return undefined;
	const match = data.slice(1).match(MODIFY_OTHER_KEYS_PRINTABLE_REGEX);
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

function getInlineCommands(pi: ExtensionAPI): InlineCommand[] {
	return pi.getCommands().map((command) => ({
		name: command.name,
		description: command.description,
		source: command.source,
		path: command.sourceInfo.path,
	}));
}

function getComposableCommands(pi: ExtensionAPI): ComposableCommand[] {
	return getInlineCommands(pi).filter(
		(command): command is ComposableCommand => command.source === "skill" || command.source === "prompt",
	);
}

function createInlineContextAutocompleteProvider(
	current: AutocompleteProvider,
	getCommands: () => InlineCommand[],
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

export class UndoRedoEditor extends CustomEditor {
	private undoHistory: Snapshot[] = [];
	private redoHistory: Snapshot[] = [];
	private lastEditWasTyping = false;
	private compactViewport = false;
	private readonly appKeybindings: KeybindingsManager;
	private readonly isComposableCommand: (value: string) => boolean;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		isComposableCommand: (value: string) => boolean,
		options?: EditorOptions,
		private readonly labelColor: (text: string) => string = (text) => text,
		private readonly getSurfaceTheme?: () => Theme,
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

		// Submission can also occur via backslash-Enter or an autocomplete action.
		// Observe the public callback rather than guessing from the pressed key.
		let submitted = false;
		const onSubmit = this.onSubmit;
		const observeSubmit = (text: string) => {
			submitted = true;
			onSubmit?.(text);
		};
		this.onSubmit = observeSubmit;
		try {
			super.handleInput(data);
		} finally {
			if (this.onSubmit === observeSubmit) this.onSubmit = onSubmit;
		}
		if (submitted) {
			this.clearPromptEditHistory();
			return;
		}

		const after = this.currentSnapshot();
		if (!sameSnapshot(before, after)) {
			requestInlineContextAutocomplete(this);
		}
		if (sameSnapshot(before, after)) return;

		// Do not let a submitted prompt become undoable in the now-empty editor.
		if (
			before.text.length > 0 &&
			after.text.length === 0 &&
			this.appKeybindings.matches(data, "app.message.followUp")
		) {
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
		if (text === before.text) restorePasteData(this, before);
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

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		// Completion may happen asynchronously after Tab, or from a mouse click.
		// Capture its boundary here instead of relying solely on handleInput().
		super.setAutocompleteProvider({
			triggerCharacters: provider.triggerCharacters,
			getSuggestions: (...args) => provider.getSuggestions(...args),
			shouldTriggerFileCompletion: (...args) => provider.shouldTriggerFileCompletion?.(...args) ?? true,
			applyCompletion: (...args) => {
				const before = this.currentSnapshot();
				const result = provider.applyCompletion(...args);
				if (result.lines.join("\n") !== before.text) {
					this.pushUndo(before);
					this.redoHistory = [];
					this.lastEditWasTyping = false;
				}
				return result;
			},
		});
	}

	override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.compactViewport) return event.type === "click" ? { handled: true, focus: true } : undefined;
		const before = this.getCursor();
		const result = super.handleMouse(event);
		const after = this.getCursor();
		if (before.line !== after.line || before.col !== after.col) this.lastEditWasTyping = false;
		return result;
	}

	override render(width: number): string[] {
		if (width <= 0) return [];
		const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
		this.compactViewport = width - padding * 2 - (padding ? 0 : 1) < 2;
		// pi-tui 1.2.0 can recurse indefinitely while wrapping a wide grapheme
		// into one text column. Keep a bounded cursor row until there is room.
		const cursor = this.getCursor();
		const prefix = this.compactViewport
			? truncateToWidth((this.getLines()[cursor.line] ?? "").slice(0, cursor.col), width - 1, "")
			: "";
		const rows = this.compactViewport
			? [
					this.renderTopBorder(width, cursor.line),
					prefix + (this.focused ? CURSOR_MARKER : "") + renderFakeCursor(" "),
					this.renderBottomBorder(width, this.getLines().length - cursor.line - 1),
				]
			: super.render(width);
		const lines = rows.map((line) => truncateToWidth(line, width, ""));
		const theme = this.getSurfaceTheme?.();
		if (!theme) return lines;
		// Reuse user-message tokens: the draft and sent message share one visual surface.
		// Only wrap native rows in ANSI styling; do not change text, spacing, cursor
		// markers, autocomplete geometry, or add any prefix/padding.
		return lines.map((line) => theme.style(line, { fg: "userMessageText", bg: "userMessageBg" }));
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		// Keep pi's overflow and embedded-working indicators authoritative.
		if (this.embedWorkingStatus) return super.renderTopBorder(width, hiddenLineCount).replace(/─/gu, " ");
		if (hiddenLineCount > 0) {
			return readableScrollChrome(super.renderTopBorder(width, hiddenLineCount), this.labelColor);
		}
		const hints: string[] = [];
		if (this.undoHistory.length > 0) hints.push("ctrl+z undo");
		if (this.redoHistory.length > 0) hints.push("ctrl+y redo");
		return composerHeader(width, this.getText().startsWith("!") ? ["shell"] : [], hints, this.labelColor);
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		return readableScrollChrome(super.renderBottomBorder(width, hiddenLineCount), this.labelColor);
	}

	private currentSnapshot(): Snapshot {
		return captureEditorSnapshot(this);
	}

	private pushUndo(snapshot: Snapshot): void {
		const last = this.undoHistory.at(-1);
		if (last && sameSnapshot(last, snapshot)) return;
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
		if (!restoreEditorSnapshotViaInternalState(this, snapshot)) {
			// Never restore an orphaned paste marker if the private layout changes.
			super.setText(snapshot.expandedText);
		}
		this.tui.requestRender();
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

	private isPlainPrintable(data: string): boolean {
		return decodePrintableInput(data) !== undefined;
	}
}

export default function promptTrulyMineExtension(pi: ExtensionAPI): void {
	let previousEditorFactory: EditorFactory | undefined;
	let installedEditorFactory: EditorFactory | undefined;

	pi.on("input", async (event, ctx) => {
		if (isExpandedContextBundle(event.text)) return { action: "continue" as const };

		const promotedExtension =
			event.source === "extension" ? null : promoteInlineExtensionCommand(event.text, getInlineCommands(pi));
		if (promotedExtension) {
			const content = event.images?.length
				? [{ type: "text" as const, text: promotedExtension.text }, ...event.images]
				: promotedExtension.text;
			if (event.streamingBehavior) {
				pi.sendUserMessage(content, {
					deliverAs: event.streamingBehavior,
					expandPromptTemplates: true,
				});
			} else {
				pi.sendUserMessage(content, { expandPromptTemplates: true });
			}
			return { action: "handled" as const };
		}

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
		if (installedEditorFactory && ctx.ui.getEditorComponent() === installedEditorFactory) return;
		const draft = ctx.ui.getEditorText();

		ctx.ui.addAutocompleteProvider((current) =>
			createInlineContextAutocompleteProvider(current, () => getInlineCommands(pi)),
		);
		const isComposableCommand = (value: string) =>
			getComposableCommands(pi).some((command) => command.name === value);

		previousEditorFactory = ctx.ui.getEditorComponent();
		installedEditorFactory = (tui, theme, keybindings) =>
			new UndoRedoEditor(
				tui,
				theme,
				keybindings,
				isComposableCommand,
				undefined,
				(text) => ctx.ui.theme.fg("muted", text),
				() => ctx.ui.theme,
			);
		ctx.ui.setEditorComponent(installedEditorFactory);
		// The host transfers getText(), which can contain editor-local paste IDs.
		if (ctx.ui.getEditorText() !== draft) ctx.ui.setEditorText(draft);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (installedEditorFactory && ctx.ui.getEditorComponent() === installedEditorFactory) {
			const draft = ctx.ui.getEditorText();
			ctx.ui.setEditorComponent(previousEditorFactory);
			if (ctx.ui.getEditorText() !== draft) ctx.ui.setEditorText(draft);
		}
		previousEditorFactory = undefined;
		installedEditorFactory = undefined;
	});
}
