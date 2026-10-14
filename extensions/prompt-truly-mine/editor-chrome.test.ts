import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";
import { composerHeader } from "./editor-chrome.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const keybindings = new KeybindingsManager();
const identity = (text: string) => text;
const theme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI;
const make = () => new UndoRedoEditor(tui, theme, keybindings, () => false);

test("rule-free header labels never exceed available width", () => {
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160]) {
		assert.equal(visibleWidth(composerHeader(width, ["shell", "ctrl+z undo", "世界"])), width);
		const header = composerHeader(width, ["shell"], ["ctrl+z undo", "ctrl+y redo", "世界"]);
		assert.equal(visibleWidth(header), width);
		assert.doesNotMatch(header, /[─│]/u);
	}
});

test("undo and redo hints are top-right, with blank top/bottom padding instead of rules", () => {
	const editor = make();
	assert.equal(plain(editor.render(80)[0]!), " ".repeat(80));
	editor.setText("draft");
	assert.equal(plain(editor.render(80)[0]!), " ".repeat(66) + " ctrl+z undo  ");
	editor.insertTextAtCursor(" change");
	editor.handleInput("\x1a");
	const rows = editor.render(80).map(plain);
	assert.match(rows[0]!, /^ +ctrl\+z undo · ctrl\+y redo  $/);
	assert.equal(rows.at(-1), " ".repeat(80));
	editor.handleInput("\x19");
	assert.doesNotMatch(plain(editor.render(80)[0]!), /redo/);
});

test("content rows and cursor markers are byte-for-byte native, without prefixes", () => {
	for (const width of [10, 40, 80, 120, 160]) {
		const custom = make();
		const native = new CustomEditor(tui, theme, keybindings);
		for (const editor of [native, custom]) {
			editor.focused = true;
			editor.setText("No prefix here\n世界 🧊 é\n    intentional indentation");
		}
		const actual = custom.render(width);
		const expected = native.render(width);
		assert.deepEqual(actual.slice(1, -1), expected.slice(1, -1));
		assert.deepEqual(custom.getCursor(), native.getCursor());
		assert.ok(actual.some((line) => line.includes(CURSOR_MARKER)));
		assert.equal(custom.getText(), native.getText());
		for (const line of actual) assert.ok(visibleWidth(line) <= width);
	}
});

test("undo, redo, paste, submission and shell label survive presentation changes", () => {
	const editor = make();
	editor.setText("draft");
	editor.insertTextAtCursor(" 世界");
	const cursor = editor.getCursor();
	editor.handleInput("\x1az".slice(0, 1));
	assert.equal(editor.getText(), "draft");
	editor.handleInput("\x19");
	assert.equal(editor.getText(), "draft 世界");
	assert.deepEqual(editor.getCursor(), cursor);
	editor.handleInput("\x1b[200~\npasted\x1b[201~");
	assert.match(editor.getExpandedText(), /pasted/);
	editor.setText("!pwd");
	assert.match(plain(editor.render(80)[0]!), /shell/);
	let submitted = "";
	editor.onSubmit = (text) => {
		submitted = text;
	};
	editor.handleInput("\r");
	assert.equal(submitted, "!pwd");
	assert.equal(editor.getText(), "");
	editor.handleInput("\x1a");
	assert.equal(editor.getText(), "");
});

test("autocomplete rows are not mistaken for the bottom border", async () => {
	const editor = make();
	const native = new CustomEditor(tui, theme, keybindings);
	const provider = {
		async getSuggestions() {
			return { prefix: "/", items: [{ value: "help", label: "help", description: "menu untouched" }] };
		},
		applyCompletion() {
			return { lines: ["/help"], cursorLine: 0, cursorCol: 5 };
		},
	};
	for (const item of [editor, native]) {
		item.setAutocompleteProvider(provider);
		item.handleInput("/");
		item.handleInput("\t");
	}
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.ok(editor.isShowingAutocomplete());
	const actual = editor.render(80);
	const expected = native.render(80);
	const helpIndex = expected.findIndex((line: string) => line.includes("menu untouched"));
	assert.ok(helpIndex > 2);
	assert.deepEqual(actual.slice(helpIndex), expected.slice(helpIndex));
	assert.match(actual[0]!, /ctrl\+z undo  $/);
	assert.equal(plain(actual[2]!), " ".repeat(80));
	for (const item of [editor, native]) item.handleInput("\x1b");
});

test("shortcut and shell labels use current text colors, independent of every thinking mode", () => {
	let palette = getThemeByName("dark");
	const editor = new UndoRedoEditor(
		tui,
		theme,
		keybindings,
		() => false,
		undefined,
		(text) => palette.fg("muted", text),
	);
	editor.setText("!pwd");
	editor.insertTextAtCursor(" x");
	editor.handleInput("\x1a");
	for (const name of ["dark", "light"]) {
		palette = getThemeByName(name);
		for (const mode of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
			editor.borderColor = palette.getThinkingBorderColor(mode);
			const border = editor.render(80)[0]!;
			assert.ok(border.includes(palette.fg("muted", "shell")), `${name}/${mode}: shell`);
			assert.ok(border.includes(palette.fg("muted", "ctrl+z undo · ctrl+y redo")), `${name}/${mode}: shortcuts`);
			assert.equal(visibleWidth(border), 80);
		}
	}
});

test("native overflow text gets readable label colors without moving its position", () => {
	const palette = getThemeByName("dark");
	const editor = new UndoRedoEditor(
		tui,
		theme,
		keybindings,
		() => false,
		undefined,
		(text) => palette.fg("muted", text),
	);
	const native = new CustomEditor(tui, theme, keybindings);
	for (const item of [editor, native]) {
		item.borderColor = palette.getThinkingBorderColor("off");
		item.setText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
	}
	for (const width of [2, 10, 40, 80, 120, 160]) {
		const actual = editor.render(width)[0]!;
		const original = plain(native.render(width)[0]!);
		assert.equal(plain(actual), original.replace(/─/gu, " "));
		assert.doesNotMatch(plain(actual), /─/u);
		const label = original.replace(/─/gu, "");
		if (label) assert.ok(actual.includes(palette.fg("muted", label)));
	}
});

test("long drafts retain native scroll indicators", () => {
	const editor = make();
	editor.setText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
	assert.match(plain(editor.render(80)[0]!), /↑.*more/);
});
