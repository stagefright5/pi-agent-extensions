import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { encodeComposableCompletionPrefix, findSlashCompletionContext } from "./inline-context.ts";

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
function field(target: object, name: string): unknown {
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
