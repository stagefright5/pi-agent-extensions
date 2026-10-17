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
	copyToClipboard,
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
	stripTerminalSequences,
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
	buildCommandCompletionItems,
	buildReferenceCompletionItems,
	buildReferenceIndex,
	decodeComposableCompletionPrefix,
	encodeComposableCompletionPrefix,
	extractReferences,
	findCompletionContext,
	findRetiredSlashReference,
	formatContextReferences,
	hasContextReferences,
	promoteInlineExtensionCommand,
	REFERENCE_LEADER,
	type ComposableCommand,
	type InlineCommand,
	type LoadedContextResource,
} from "./inline-context.ts";

import { readableScrollChrome } from "./editor-chrome.ts";
import { SearchIndex, Searcher } from "@stagefright5/pi-picker";
import {
	composerPalette,
	halfRow,
	INPUT_HINTS,
	paintRow,
	renderFooter,
	renderMenuPanel,
	renderPlaceholder,
	withRail,
	type FooterHint,
} from "./composer-style.ts";

type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

import {
	captureEditorSnapshot,
	copyOnSelectEnabled,
	expandPasteMarkers,
	flash,
	getEditorHistory,
	getAutocompleteView,
	getNativeAutocompleteHeight,
	getVisibleVisualRows,
	repairExitCursorCell,
	setEditorHistory,
	makeSelectedContextCompletionComposable,
	requestInlineContextAutocomplete,
	restoreEditorSnapshotViaInternalState,
	restorePasteData,
	type Snapshot,
} from "./editor-compat.ts";
import {
	highlightRow,
	lineRangeAt,
	orderedRange,
	positionAtColumn,
	selectedText,
	wordRangeAt,
	type TextPosition,
	type TextRange,
} from "./editor-selection.ts";

const MAX_HISTORY = 200;
// Survives extension-module replacement during /reload within one Pi process.
const RETAINED_HISTORY = Symbol.for("@stagefright5/pi-prompt-truly-mine/history");

/** Newer sources first; repeated prompts appear once in seeded recall. */
function seedHistory(editor: UndoRedoEditor, persisted: readonly string[]): void {
	const merged = [...(getEditorHistory(editor) ?? []), ...retainedHistory(), ...persisted].map((text) => text.trim());
	setEditorHistory(editor, [...new Set(merged.filter(Boolean))]);
}

function retainedHistory(): string[] {
	const value = Reflect.get(globalThis, RETAINED_HISTORY);
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
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

/** The typed text behind a completion prefix: `/mo` → `mo`, `@src/x` → `src/x`, `$ang` → `ang`. */
export function completionQuery(prefix: string): string {
	return (decodeComposableCompletionPrefix(prefix) ?? prefix).replace(/^[/@$]/u, "");
}

type Suggestions = Awaited<ReturnType<AutocompleteProvider["getSuggestions"]>>;

/**
 * Re-rank Pi's suggestions with the shared engine (word starts and consecutive letters first; ties
 * keep Pi's order). Items Pi matched but the shared engine does not stay, after the ranked ones.
 */
export function rankSuggestions(suggestions: Suggestions): Suggestions {
	if (!suggestions || suggestions.items.length < 2) return suggestions;
	const query = completionQuery(suggestions.prefix);
	if (!query.trim()) return suggestions;
	const items = suggestions.items;
	const index = new SearchIndex((item: (typeof items)[number]) => item.label || item.value, items);
	const ranked = Array.from(new Searcher(index).search(query, { limit: items.length }).ids, (id) => items[id]!);
	const seen = new Set(ranked);
	return { ...suggestions, items: [...ranked, ...items.filter((item) => !seen.has(item))] };
}

function createInlineContextAutocompleteProvider(
	current: AutocompleteProvider,
	getCommands: () => InlineCommand[],
): AutocompleteProvider {
	const composable = () =>
		getCommands().filter((command): command is ComposableCommand => command.source !== "extension");
	return {
		// `$` opens skill/template completion anywhere in the draft.
		triggerCharacters: [...new Set([...(current.triggerCharacters ?? []), REFERENCE_LEADER])],

		async getSuggestions(lines, cursorLine, cursorCol, options) {
			// Explicit Tab retains Pi's normal forced file/path completion.
			if (options.force) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const context = findCompletionContext(lines, cursorLine, cursorCol);
			if (context?.leader === "$") {
				const items = buildReferenceCompletionItems(buildReferenceIndex(composable()), context.query);
				if (items.length === 0) return null;
				return rankSuggestions({ items, prefix: encodeComposableCompletionPrefix(context.prefix) });
			}
			if (!context || context.isInitialCommand) {
				const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				// `/` is for commands only: skills and prompt templates attach with `$name`.
				if (context?.isInitialCommand && suggestions) {
					const retired = new Set(composable().map((command) => command.name));
					const items = suggestions.items.filter((item) => !retired.has(item.value));
					return items.length ? rankSuggestions({ ...suggestions, items }) : null;
				}
				return rankSuggestions(suggestions);
			}

			const items = buildCommandCompletionItems(getCommands(), context.query);
			if (items.length === 0) return null;
			return rankSuggestions({
				items,
				prefix: encodeComposableCompletionPrefix(context.prefix),
			});
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
	private menuHeight = 0;
	private menuItemRows = 0;
	private composerHeight = 0;
	private selectionAnchor: TextPosition | undefined;
	private selectionFocus: TextPosition | undefined;
	private selecting = false;
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
		private readonly onSlashSubmit?: (text: string) => void,
		private readonly copyText: (text: string) => Promise<void> = copyToClipboard,
	) {
		super(tui, theme, keybindings, options);
		this.appKeybindings = keybindings;
		this.isComposableCommand = isComposableCommand;
	}

	override handleInput(data: string): void {
		if (this.selectionRange()) {
			const copy = this.appKeybindings.matches(data, "tui.input.copy");
			if (copy) this.copySelection();
			this.clearSelection();
			if (copy) return;
		}

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
			if (text.trim().startsWith("/")) {
				// Built-in commands return before Pi adds ordinary input to history.
				// Native addToHistory deduplicates the host's subsequent insertion.
				this.addToHistory(text);
				this.onSlashSubmit?.(text.trim());
			}
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
		this.clearSelection();
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
		this.clearSelection();
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
		// The legend row and no-match row are display-only.
		if (event.y >= this.menuItemRows && event.y < this.menuHeight) return { handled: true };
		const before = this.getCursor();
		// Native hit testing expects [composer, menu]; render displays [menu, composer].
		// Extra display rows (half-row padding, footer strip) map onto the native bottom border.
		const y =
			event.y < this.menuHeight
				? event.y + this.composerHeight
				: Math.min(event.y - this.menuHeight, Math.max(0, this.composerHeight - 1));
		const local = { ...event, y };
		// A captured drag may leave the composer; clamp it relative to the composer, not the menu.
		const selection = this.selecting
			? this.handleSelectionMouse({ ...event, y: event.y - this.menuHeight })
			: y < this.composerHeight
				? this.handleSelectionMouse(local)
				: undefined;
		if (selection) return selection;
		const result = super.handleMouse(local);
		const after = this.getCursor();
		if (before.line !== after.line || before.col !== after.col) this.lastEditWasTyping = false;
		return result;
	}

	override render(width: number): string[] {
		this.menuHeight = 0;
		this.composerHeight = 0;
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
		const range = this.compactViewport ? undefined : this.selectionRange();
		const visible = range ? getVisibleVisualRows(this) : undefined;
		if (range && visible) {
			const lines = this.getLines();
			visible.forEach(({ row, isLast }, index) => {
				rows[index + 1] = highlightRow(rows[index + 1]!, lines, row, range, padding, width, isLast);
			});
		}
		const nativeMenuHeight = this.compactViewport ? 0 : getNativeAutocompleteHeight(this, rows.length);
		this.composerHeight = rows.length - nativeMenuHeight;
		const fit = (line: string) => truncateToWidth(line, width, "");
		const composer = rows.slice(0, this.composerHeight).map(fit);
		const nativeMenu = rows.slice(this.composerHeight).map(fit);
		const theme = this.getSurfaceTheme?.();
		if (!theme) {
			this.menuHeight = this.menuItemRows = nativeMenu.length;
			// Keep the composer at the bottom as suggestions open, filter, and close.
			return [...nativeMenu, ...composer];
		}
		// Reuse user-message tokens: the draft and sent message share one visual surface.
		const surface = (line: string) => theme.style(line, { fg: "userMessageText", bg: "userMessageBg" });
		if (this.compactViewport) {
			this.menuHeight = this.menuItemRows = 0;
			const lines = composer.map(surface);
			this.trackExitCursorCell(lines, theme);
			return lines;
		}
		const palette = composerPalette(theme);
		const text = this.getText();
		const [top = "", ...rest] = composer;
		const content = rest.slice(0, -1);
		const bottom = rest.at(-1) ?? "";
		if (text === "" && content.length === 1 && !range) {
			content[0] = renderPlaceholder(
				width,
				padding,
				(this.focused ? CURSOR_MARKER : "") + renderFakeCursor(" "),
				palette,
			);
		}
		// A thin rail in the left inset of the draft rows carries the mode by color; the text never moves.
		const rail = padding > 0 ? palette.fg(text.startsWith("!") ? "bashMode" : "accent", "\u258e") : undefined;
		const railed = (line: string) => (rail ? withRail(line, rail) : line);
		// Half-row padding keeps the draft and the footer labels vertically centred in their bars.
		// Rows carrying native text (scroll or working indicators) stay full rows so they remain readable.
		const painted = [
			stripTerminalSequences(top).trim() ? surface(top) : halfRow(width, "\u2584", palette.surface),
			...content.map((line) => surface(railed(line))),
			// The rail stays on draft rows: a split half-row cell cannot also carry the rail cleanly.
			halfRow(width, "\u2580", palette.surface, palette.footer),
			paintRow(bottom, width, palette.text, palette.footer),
			halfRow(width, "\u2580", palette.footer),
		];
		const view = nativeMenu.length ? getAutocompleteView(this, nativeMenu.length) : undefined;
		const menu = view
			? renderMenuPanel(view, width, padding, palette, completionQuery(view.prefix)).map((row) =>
					paintRow(fit(row.text), width, palette.text, row.selected ? palette.menuSelected : palette.menu),
				)
			: nativeMenu.map(surface);
		this.menuHeight = menu.length;
		// Item rows keep native order; only the trailing legend row has no native counterpart.
		this.menuItemRows = view ? (view.items.length ? view.end - view.start : 0) : menu.length;
		this.trackExitCursorCell(painted, theme);
		// Keep the composer at the bottom as suggestions open, filter, and close.
		return [...menu, ...painted];
	}

	/** The surface-styled glyph under the cursor, so exiting Pi never punches a hole in the composer. */
	private exitCursorCell: string | undefined;

	private trackExitCursorCell(lines: readonly string[], theme: Theme): void {
		this.exitCursorCell = undefined;
		if (!this.focused) return;
		const [start = "", end = ""] = renderFakeCursor("\u0000").split("\u0000");
		for (const line of lines) {
			const at = line.indexOf(CURSOR_MARKER + start);
			if (at < 0) continue;
			const from = at + CURSOR_MARKER.length + start.length;
			const to = line.indexOf(end, from);
			const glyph = stripTerminalSequences(line.slice(from, to < 0 ? undefined : to)) || " ";
			this.exitCursorCell = theme.style(glyph, { fg: "userMessageText", bg: "userMessageBg" });
			break;
		}
		repairExitCursorCell(this.tui, () => (this.focused ? this.exitCursorCell : undefined));
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		// Keep pi's overflow and embedded-working indicators authoritative.
		if (this.embedWorkingStatus) return super.renderTopBorder(width, hiddenLineCount).replace(/─/gu, " ");
		if (hiddenLineCount > 0) {
			return readableScrollChrome(super.renderTopBorder(width, hiddenLineCount), this.labelColor);
		}
		// The top padding row stays blank; mode and hints live in the footer strip.
		return " ".repeat(Math.max(0, width));
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (hiddenLineCount > 0) {
			return readableScrollChrome(super.renderBottomBorder(width, hiddenLineCount), this.labelColor);
		}
		const text = this.getText();
		const mode = text.startsWith("!!") ? "shell · no context" : text.startsWith("!") ? "shell" : undefined;
		// Discoverability hints by default; right after an undo, undo/redo takes their place.
		const hints: readonly FooterHint[] =
			this.redoHistory.length > 0
				? [
						...(this.undoHistory.length > 0 ? [{ key: "⌃Z", action: "undo" }] : []),
						{ key: "⌃Y", action: "redo" },
					]
				: INPUT_HINTS;
		const theme = this.getSurfaceTheme?.();
		const palette = theme
			? composerPalette(theme)
			: { fg: (_token: string, value: string) => this.labelColor(value), bold: (value: string) => value };
		const inset = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
		return renderFooter(width, inset, mode, hints, palette);
	}

	/**
	 * Fullscreen selection over the composer copies source text only. The visual
	 * inset, wrap breaks, header hints, and cursor never become copied characters.
	 */
	private handleSelectionMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.button !== "left") return undefined;
		if (event.type === "click") {
			const count = event.clickCount ?? 1;
			if (count < 2) {
				this.clearSelection();
				return undefined; // Native click positions the cursor.
			}
			const position = this.positionAt(event);
			const range = position
				? count === 2
					? wordRangeAt(this.getLines(), position)
					: lineRangeAt(this.getLines(), position.line)
				: undefined;
			if (!range) return { handled: true, focus: true };
			this.selectionAnchor = range.start;
			this.selectionFocus = range.end;
			if (copyOnSelectEnabled(this.tui)) this.copySelection();
			this.tui.requestRender();
			return { handled: true, focus: true };
		}
		if (event.type === "press") {
			const position = this.positionAt(event);
			if (!position) return undefined; // Unknown native layout: retain screen selection.
			this.clearSelection();
			this.selectionAnchor = position;
			this.selectionFocus = position;
			this.selecting = true;
			return { capture: true, focus: true };
		}
		if (!this.selecting) return undefined;
		if (event.type === "drag") {
			this.selectionFocus = this.positionAt(event) ?? this.selectionFocus;
			this.tui.requestRender();
			return { handled: true };
		}
		if (event.type === "release") {
			this.selecting = false;
			if (this.selectionRange() && copyOnSelectEnabled(this.tui)) this.copySelection();
			this.tui.requestRender();
			return { handled: true };
		}
		return undefined;
	}

	private positionAt(event: TuiMouseEvent): TextPosition | undefined {
		const visible = getVisibleVisualRows(this);
		if (!visible?.length) return undefined;
		const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((event.width - 1) / 2)));
		const lines = this.getLines();
		// Dragging over the header or footer selects to the visible edge.
		if (event.y < 1) return positionAtColumn(lines, visible[0]!.row, 0, visible[0]!.isLast);
		const last = visible.at(-1)!;
		if (event.y > visible.length) return positionAtColumn(lines, last.row, Number.POSITIVE_INFINITY, true);
		const target = visible[event.y - 1]!;
		return positionAtColumn(lines, target.row, Math.max(0, event.x - padding), target.isLast);
	}

	private selectionRange(): TextRange | undefined {
		return this.selectionAnchor && this.selectionFocus
			? orderedRange(this.selectionAnchor, this.selectionFocus)
			: undefined;
	}

	private clearSelection(): void {
		const visible = this.selectionRange() !== undefined;
		this.selectionAnchor = undefined;
		this.selectionFocus = undefined;
		this.selecting = false;
		if (visible) this.tui.requestRender();
	}

	private copySelection(): void {
		const range = this.selectionRange();
		if (!range) return;
		const text = expandPasteMarkers(this, selectedText(this.getLines(), range));
		void this.copyText(text).then(
			() => flash(this.tui, "Copied!"),
			() => flash(this.tui, "Copy failed"),
		);
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
		this.clearSelection();
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
	let installedEditor: UndoRedoEditor | undefined;
	let persistedHistory: string[] = [];

	// Optional: Prompt History Search offers its saved index on session start.
	pi.events.on("prompt-history-search:recent", (value) => {
		const prompts = value && typeof value === "object" ? Reflect.get(value, "prompts") : undefined;
		if (!Array.isArray(prompts)) return;
		persistedHistory = prompts.filter((entry): entry is string => typeof entry === "string");
		if (installedEditor) seedHistory(installedEditor, persistedHistory);
	});

	pi.on("input", async (event, ctx) => {
		if (hasContextReferences(event.text)) return { action: "continue" as const };
		const resend = (text: string, expandPromptTemplates: boolean) => {
			const content = event.images?.length ? [{ type: "text" as const, text }, ...event.images] : text;
			if (event.streamingBehavior) {
				pi.sendUserMessage(content, { deliverAs: event.streamingBehavior, expandPromptTemplates });
			} else {
				pi.sendUserMessage(content, { expandPromptTemplates });
			}
			return { action: "handled" as const };
		};

		const promotedExtension =
			event.source === "extension" ? null : promoteInlineExtensionCommand(event.text, getInlineCommands(pi));
		if (promotedExtension) return resend(promotedExtension.text, true);

		const availableCommands = getComposableCommands(pi);
		// The old `/skill:name` and leading `/template` forms are retired in favor of `$name`.
		const retired = event.source === "extension" ? null : findRetiredSlashReference(event.text, availableCommands);
		if (retired && ctx.hasUI) {
			const kind = retired.source === "skill" ? "Skills" : "Prompt templates";
			if (!ctx.ui.getEditorText().trim()) ctx.ui.setEditorText(event.text);
			ctx.ui.notify(`${kind} attach with $name now. Try $${retired.name}`, "warning");
			return { action: "handled" as const };
		}

		const { resources: referencedCommands, shadowed } = extractReferences(
			event.text,
			buildReferenceIndex(availableCommands),
		);
		if (shadowed.length && ctx.hasUI) {
			const names = shadowed.map((name) => `$${name}`).join(", ");
			ctx.ui.notify(`${names} matches both a skill and a prompt template; attached the skill`, "warning");
		}
		if (referencedCommands.length === 0) return { action: "continue" as const };

		const resources = await loadContextResources(referencedCommands, ctx);
		if (resources.length === 0) return { action: "continue" as const };

		const text = formatContextReferences(event.text, resources);
		return { action: "transform" as const, text };
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
		installedEditorFactory = (tui, theme, keybindings) => {
			const editor = new UndoRedoEditor(
				tui,
				theme,
				keybindings,
				isComposableCommand,
				undefined,
				(text) => ctx.ui.theme.fg("muted", text),
				() => ctx.ui.theme,
				(text) =>
					pi.events.emit("prompt-truly-mine:slash-submit", {
						text,
						timestamp: Date.now(),
						sessionPath: ctx.sessionManager.getSessionFile() ?? "",
						sessionName: ctx.sessionManager.getSessionName(),
						cwd: ctx.cwd,
					}),
			);
			// Replacing the editor on reload/session switch must not discard Up/Down recall.
			seedHistory(editor, persistedHistory);
			installedEditor = editor;
			return editor;
		};
		ctx.ui.setEditorComponent(installedEditorFactory);
		// The host transfers getText(), which can contain editor-local paste IDs.
		if (ctx.ui.getEditorText() !== draft) ctx.ui.setEditorText(draft);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const history = installedEditor ? getEditorHistory(installedEditor) : undefined;
		if (history) Reflect.set(globalThis, RETAINED_HISTORY, history);
		installedEditor = undefined;
		if (installedEditorFactory && ctx.ui.getEditorComponent() === installedEditorFactory) {
			const draft = ctx.ui.getEditorText();
			ctx.ui.setEditorComponent(previousEditorFactory);
			if (ctx.ui.getEditorText() !== draft) ctx.ui.setEditorText(draft);
		}
		previousEditorFactory = undefined;
		installedEditorFactory = undefined;
	});
}
