import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { encodeComposableCompletionPrefix, findSlashCompletionContext } from "./inline-context.ts";
import type { VisualRow } from "./editor-selection.ts";

interface PasteData {
	entries: ReadonlyArray<readonly [number, string]>;
	counter: number;
}
export interface Snapshot {
	text: string;
	expandedText: string;
	cursor: { line: number; col: number };
	pastes?: PasteData;
}

// pi-tui 1.2.0 has no public snapshot restore or explicit autocomplete request.
// Keep that compatibility boundary here, validate values before use, and never
// assert that a CustomEditor implements an invented public SDK interface.
function field(target: object, name: PropertyKey): unknown {
	return Reflect.get(target, name);
}
function isObject(value: unknown): value is object {
	return value !== null && typeof value === "object";
}
function call(target: object, name: string, args: unknown[] = []): unknown {
	const method = field(target, name);
	if (typeof method !== "function") return undefined;
	return Reflect.apply(method, target, args);
}
function isPasteMap(value: unknown): value is Map<number, string> {
	return (
		value instanceof Map &&
		[...value].every(([id, text]) => Number.isInteger(id) && id > 0 && typeof text === "string")
	);
}
function pasteData(editor: CustomEditor): PasteData | undefined {
	const pastes = field(editor, "pastes");
	const counter = field(editor, "pasteCounter");
	if (!isPasteMap(pastes) || typeof counter !== "number" || !Number.isInteger(counter) || counter < 0)
		return undefined;
	return { entries: [...pastes], counter };
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Native Up/Down history, newest first. */
export function getEditorHistory(editor: CustomEditor): string[] | undefined {
	const history = field(editor, "history");
	return isStringArray(history) ? [...history] : undefined;
}

/** Seed native history in place, keeping its newest-first and consecutive-dedupe rules. */
export function setEditorHistory(editor: CustomEditor, entries: readonly string[]): boolean {
	const history = field(editor, "history");
	if (!isStringArray(history)) return false;
	const next: string[] = [];
	for (const entry of entries) {
		const text = entry.trim();
		if (text && next.at(-1) !== text) next.push(text);
		if (next.length === 100) break;
	}
	history.splice(0, history.length, ...next);
	return true;
}

function isVisualRow(value: unknown): value is VisualRow {
	return (
		isObject(value) &&
		"logicalLine" in value &&
		Number.isInteger(value.logicalLine) &&
		"startCol" in value &&
		Number.isInteger(value.startCol) &&
		"length" in value &&
		Number.isInteger(value.length)
	);
}

/** Source ranges for the content rows from the latest native render. */
export function getVisibleVisualRows(editor: CustomEditor): Array<{ row: VisualRow; isLast: boolean }> | undefined {
	try {
		const count = field(editor, "renderedVisibleLineCount");
		const offset = field(editor, "scrollOffset");
		const width = field(editor, "lastWidth");
		if (!Number.isInteger(count) || !Number.isInteger(offset) || !Number.isInteger(width)) return undefined;
		const all = call(editor, "buildVisualLineMap", [width]);
		if (!Array.isArray(all) || !all.every(isVisualRow)) return undefined;
		const start = offset as number;
		const rows = all.slice(start, start + (count as number));
		if (rows.length !== count) return undefined;
		return rows.map((row, index) => ({
			row,
			isLast: all[start + index + 1]?.logicalLine !== row.logicalLine,
		}));
	} catch {
		return undefined;
	}
}

/** Copy pasted payloads rather than their collapsed placeholders. */
export function expandPasteMarkers(editor: CustomEditor, text: string): string {
	try {
		const expanded = call(editor, "expandPasteMarkers", [text]);
		return typeof expanded === "string" ? expanded : text;
	} catch {
		return text;
	}
}

/** Fullscreen renderer preferences; regular mode has no mouse selection. */
export function copyOnSelectEnabled(tui: object): boolean {
	try {
		const enabled = call(tui, "getCopyOnSelect");
		return typeof enabled === "boolean" ? enabled : true;
	} catch {
		return true;
	}
}

export function flash(tui: object, message: string): void {
	try {
		call(tui, "flash", [message]);
	} catch {
		// Optional feedback only.
	}
}

/** Validate the native [top, text, bottom, menu] layout before moving its tail. */
/**
 * The native autocomplete list's visible window, validated against the rows the editor just
 * rendered (items plus an optional scroll row, or a single no-match row). Returns undefined when
 * the private shape is unknown, so callers keep native rendering.
 */
export function getAutocompleteView(
	editor: CustomEditor,
	renderedMenuHeight: number,
):
	| {
			items: { label: string; description?: string }[];
			selectedIndex: number;
			start: number;
			end: number;
			prefix: string;
	  }
	| undefined {
	if (!field(editor, "autocompleteState")) return undefined;
	const list = field(editor, "autocompleteList");
	if (!isObject(list)) return undefined;
	const items = field(list, "filteredItems");
	const selectedIndex = field(list, "selectedIndex");
	const range = call(list, "getVisibleRange");
	if (!Array.isArray(items) || typeof selectedIndex !== "number" || !isObject(range)) return undefined;
	const start = field(range, "startIndex");
	const end = field(range, "endIndex");
	if (typeof start !== "number" || typeof end !== "number" || start < 0 || end < start || end > items.length) {
		return undefined;
	}
	const expected = items.length === 0 ? 1 : end - start + (start > 0 || end < items.length ? 1 : 0);
	if (expected !== renderedMenuHeight) return undefined;
	const views: { label: string; description?: string }[] = [];
	for (const item of items) {
		if (!isObject(item)) return undefined;
		const label = field(item, "label") || field(item, "value");
		const description = field(item, "description");
		if (typeof label !== "string") return undefined;
		views.push(typeof description === "string" ? { label, description } : { label });
	}
	const prefix = field(editor, "autocompletePrefix");
	return { items: views, selectedIndex, start, end, prefix: typeof prefix === "string" ? prefix : "" };
}

const EXIT_CELL_REPAIR = Symbol.for("@stagefright5/pi-prompt-truly-mine/exit-cell-repair");

/**
 * Pi's regular-screen renderer erases the cursor on exit by writing a bare space at the hardware
 * cursor, after every attribute was reset. Over a filled composer that leaves a terminal-default
 * (black) hole in the transcript. Substitute that one write with the surface-styled cell.
 * Applies only to regular-screen renderers (also used for the fullscreen exit transcript); any
 * other first write passes through unchanged. Idempotent per renderer.
 */
export function repairExitCursorCell(tui: object, cell: () => string | undefined): void {
	if (field(tui, "mode") !== "regular" || field(tui, EXIT_CELL_REPAIR)) return;
	// Read the method from the prototype: the interactive TUI reference is a forwarding proxy.
	const prototype: unknown = Object.getPrototypeOf(tui);
	const original = isObject(prototype) ? field(prototype, "beforeTerminalStop") : undefined;
	const terminal = field(tui, "terminal");
	if (typeof original !== "function" || !isObject(terminal) || typeof field(terminal, "write") !== "function") return;
	Reflect.set(tui, EXIT_CELL_REPAIR, true);
	Reflect.set(tui, "beforeTerminalStop", function (this: object, ...args: unknown[]): unknown {
		const ownWrite = Object.hasOwn(terminal, "write");
		const write = field(terminal, "write") as (data: string) => unknown;
		let first = true;
		Reflect.set(terminal, "write", (data: string) => {
			const replacement = first && data === " " ? cell() : undefined;
			first = false;
			return Reflect.apply(write, terminal, [replacement ?? data]);
		});
		try {
			return Reflect.apply(original, this, args);
		} finally {
			if (ownWrite) Reflect.set(terminal, "write", write);
			else Reflect.deleteProperty(terminal, "write");
		}
	});
}

export function getNativeAutocompleteHeight(editor: CustomEditor, rowCount: number): number {
	const menu = field(editor, "renderedAutocompleteHeight");
	const content = field(editor, "renderedVisibleLineCount");
	return editor.isShowingAutocomplete() &&
		typeof menu === "number" &&
		Number.isInteger(menu) &&
		menu > 0 &&
		typeof content === "number" &&
		Number.isInteger(content) &&
		content > 0 &&
		content + 2 + menu === rowCount
		? menu
		: 0;
}

export function captureEditorSnapshot(editor: CustomEditor): Snapshot {
	return {
		text: editor.getText(),
		expandedText: editor.getExpandedText(),
		cursor: editor.getCursor(),
		pastes: pasteData(editor),
	};
}

/** setText(getText()) is used by native UI restoration; retain its paste payloads. */
export function restorePasteData(editor: CustomEditor, snapshot: Snapshot): void {
	if (!snapshot.pastes || !pasteData(editor)) return;
	Reflect.set(editor, "pastes", new Map(snapshot.pastes.entries));
	Reflect.set(editor, "pasteCounter", snapshot.pastes.counter);
}

function isEditorState(value: unknown): value is { lines: string[]; cursorLine: number; cursorCol: number } {
	return (
		isObject(value) &&
		"lines" in value &&
		Array.isArray(value.lines) &&
		value.lines.every((line) => typeof line === "string") &&
		"cursorLine" in value &&
		typeof value.cursorLine === "number" &&
		"cursorCol" in value &&
		typeof value.cursorCol === "number"
	);
}

/** Return false when the pinned layout no longer matches; callers use expanded text. */
export function restoreEditorSnapshotViaInternalState(editor: CustomEditor, snapshot: Snapshot): boolean {
	try {
		const state = field(editor, "state");
		const undoStack = field(editor, "undoStack");
		if (
			!isEditorState(state) ||
			!snapshot.pastes ||
			!pasteData(editor) ||
			!isObject(undoStack) ||
			typeof field(undoStack, "clear") !== "function" ||
			typeof field(editor, "cancelAutocomplete") !== "function"
		)
			return false;
		call(editor, "cancelAutocomplete");
		state.lines = snapshot.text.split("\n");
		state.cursorLine = Math.max(0, Math.min(snapshot.cursor.line, state.lines.length - 1));
		state.cursorCol = Math.max(0, Math.min(snapshot.cursor.col, state.lines[state.cursorLine]!.length));
		restorePasteData(editor, snapshot);
		for (const [name, value] of Object.entries({
			historyIndex: -1,
			lastAction: null,
			preferredVisualCol: null,
			snappedFromCursorCol: null,
			scrollOffset: 0,
		}))
			Reflect.set(editor, name, value);
		call(undoStack, "clear");
		editor.onChange?.(editor.getText());
		return true;
	} catch {
		return false;
	}
}

export function requestInlineContextAutocomplete(editor: CustomEditor): boolean {
	try {
		if (editor.isShowingAutocomplete() || typeof field(editor, "requestAutocomplete") !== "function") return false;
		const cursor = editor.getCursor();
		const context = findSlashCompletionContext(editor.getLines(), cursor.line, cursor.col);
		if (!context || context.isInitialCommand) return false;
		call(editor, "requestAutocomplete", [{ force: false, explicitTab: false }]);
		return true;
	} catch {
		return false;
	}
}

export function makeSelectedContextCompletionComposable(
	editor: CustomEditor,
	isComposableCommand: (value: string) => boolean,
): boolean {
	try {
		const prefix = field(editor, "autocompletePrefix");
		const list = field(editor, "autocompleteList");
		if (typeof prefix !== "string" || !prefix.startsWith("/") || !isObject(list)) return false;
		const selected = call(list, "getSelectedItem");
		if (
			!isObject(selected) ||
			!("value" in selected) ||
			typeof selected.value !== "string" ||
			!isComposableCommand(selected.value)
		)
			return false;
		return Reflect.set(editor, "autocompletePrefix", encodeComposableCompletionPrefix(prefix));
	} catch {
		return false;
	}
}
