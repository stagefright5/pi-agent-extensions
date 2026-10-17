import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";
import { renderFooter, renderMenuPanel, stripSourceTag, truncateWords } from "./composer-style.ts";

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

const plainPalette = { fg: (_token: string, text: string) => text, bold: identity };

test("footer rows fill exactly the available width at every inset and drop hints rather than overflow", () => {
	const hints = [
		{ key: "⌃Z", action: "undo" },
		{ key: "⌃Y", action: "redo" },
	];
	for (const width of [0, 1, 2, 5, 10, 40, 80, 120, 160]) {
		for (const inset of [0, 1, 3]) {
			for (const mode of [undefined, "shell", "shell · 世界"]) {
				const row = renderFooter(width, inset, mode, hints, plainPalette);
				assert.equal(visibleWidth(row), width, `${width}/${inset}/${mode}`);
				assert.doesNotMatch(row, /[─│]/u);
			}
		}
	}
	assert.equal(renderFooter(30, 1, "shell", hints, plainPalette), " shell" + " ".repeat(7) + "⌃Z undo  ⌃Y redo ");
	assert.equal(renderFooter(20, 1, "shell", hints, plainPalette), " shell" + " ".repeat(6) + "⌃Z undo ");
	assert.equal(renderFooter(20, 1, undefined, [], plainPalette), " ".repeat(20));
});

test("menu text helpers cut at word boundaries and drop Pi scope tags", () => {
	assert.equal(truncateWords("Clean up stale or unresolved Jira workitems", 24), "Clean up stale or…");
	assert.equal(truncateWords("supercalifragilistic", 8), "superca…");
	assert.equal(truncateWords("short", 8), "short");
	assert.equal(truncateWords("anything", 1), "…");
	assert.equal(stripSourceTag("[u] Search prompts"), "Search prompts");
	assert.equal(stripSourceTag("[u:npm:pkg] Thing"), "Thing");
	assert.equal(stripSourceTag("No tag [here]"), "No tag [here]");
	const palette = { ...plainPalette, text: "", surface: "", footer: "", menu: "", menuSelected: "" };
	const items = Array.from({ length: 8 }, (_, i) => ({ label: `item-${i}`, description: `[u] description ${i}` }));
	for (const width of [10, 30, 80, 160]) {
		const rows = renderMenuPanel({ items, selectedIndex: 2, start: 0, end: 5 }, width, 1, palette);
		assert.equal(rows.length, 6, "five items plus the legend row");
		assert.deepEqual(
			rows.map((row) => row.selected),
			[false, false, true, false, false, false],
		);
		for (const row of rows) assert.ok(visibleWidth(row.text) <= width, `${width}: ${row.text}`);
	}
	const rows = renderMenuPanel({ items, selectedIndex: 2, start: 0, end: 5 }, 80, 1, palette).map((row) => row.text);
	assert.match(rows[2]!, /^ › item-2 +description 2$/u);
	assert.doesNotMatch(rows.join("\n"), /\[u\]/u);
	assert.match(rows[5]!, /^ {3}3\/8 +↑↓ select {2}⇥ complete {2}esc close$/u);
	assert.deepEqual(
		renderMenuPanel({ items: [], selectedIndex: 0, start: 0, end: 0 }, 40, 1, palette).map((row) => row.text),
		["   No matches"],
	);
});

test("the footer carries the mode and, after an undo, undo/redo; input hints live in the empty draft", () => {
	const editor = make();
	editor.setPaddingX(1);
	editor.setText("draft");
	let rows = editor.render(80).map(plain);
	assert.equal(rows[0], " ".repeat(80), "the top padding row stays blank");
	assert.equal(rows.at(-1), " ".repeat(80), "no footer hints while drafting");
	editor.insertTextAtCursor(" change");
	editor.handleInput("\x1a");
	rows = editor.render(80).map(plain);
	assert.match(rows.at(-1)!, /^ +⌃Z undo {2}⌃Y redo $/u, "undo/redo replaces the input hints after an undo");
	editor.handleInput("\x19");
	assert.equal(plain(editor.render(80).at(-1)!), " ".repeat(80), "undo/redo hints leave with the redo stack");
	editor.setText("!!git status");
	rows = editor.render(80).map(plain);
	assert.equal(rows[0], " ".repeat(80));
	assert.match(rows.at(-1)!, /^ shell · no context +$/u);
	assert.equal(rows[1]!.indexOf("!"), rows.at(-1)!.indexOf("s"), "label aligns with the draft text");
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
	assert.match(plain(editor.render(80).at(-1)!), /shell/);
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
	const menuHeight = expected.length - helpIndex;
	assert.deepEqual(actual.slice(0, menuHeight), expected.slice(helpIndex));
	assert.equal(plain(actual[menuHeight]!), " ".repeat(80));
	assert.equal(plain(actual.at(-1)!).trim(), "", "no redo yet: an empty footer");
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
			const rows = editor.render(80);
			assert.ok(rows.at(-1)!.includes(palette.fg("muted", "shell")), `${name}/${mode}: shell`);
			for (const text of ["⌃Z", "undo", "⌃Y", "redo"]) {
				assert.ok(rows.at(-1)!.includes(palette.fg("muted", text)), `${name}/${mode}: ${text}`);
			}
			assert.equal(visibleWidth(rows[0]!), 80);
			assert.equal(visibleWidth(rows.at(-1)!), 80);
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

test("suggestions are re-ranked by the shared engine and the typed text is highlighted", async () => {
	const { completionQuery, rankSuggestions } = await import("./index.ts");
	assert.equal(completionQuery("/mo"), "mo");
	assert.equal(completionQuery("@src/comp"), "src/comp");
	const ranked = rankSuggestions({
		prefix: "/mod",
		items: [
			{ value: "scoped-models", label: "scoped-models" },
			{ value: "import", label: "import" },
			{ value: "model", label: "model" },
		],
	});
	assert.deepEqual(
		ranked?.items.map((item) => item.value),
		["model", "scoped-models", "import"],
		"word-start match first; Pi-only matches stay at the end",
	);
	assert.equal(rankSuggestions(null), null);
	const palette = {
		...plainPalette,
		text: "",
		surface: "",
		footer: "",
		menu: "",
		menuSelected: "",
		match: (text: string) => `[${text}]`,
	};
	const rows = renderMenuPanel(
		{ items: [{ label: "model", description: "[u] Pick a model" }], selectedIndex: 0, start: 0, end: 1 },
		60,
		1,
		palette,
		"mod",
	);
	assert.match(rows[0]!.text, /^ › \[mod\]el +Pick a \[mod\]el$/u);
});
