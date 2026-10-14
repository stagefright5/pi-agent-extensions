import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName, loadThemeFromPath } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const path = fileURLToPath(new URL("../obsidian-ui/themes/obsidian-ice.json", import.meta.url));
const identity = (text: string) => text;
const editorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: (text: string) => `\x1b[36m${text}\x1b[39m`,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI;
const keybindings = new KeybindingsManager();

function pair(initial = getThemeByName("dark")) {
	let palette = initial;
	const reference = new UndoRedoEditor(tui, editorTheme, keybindings, () => false);
	const surfaced = new UndoRedoEditor(
		tui,
		editorTheme,
		keybindings,
		() => false,
		undefined,
		identity,
		() => palette,
	);
	return {
		reference,
		surfaced,
		setPalette(next: typeof palette) {
			palette = next;
		},
		check(width: number) {
			const expected = reference.render(width);
			const actual = surfaced.render(width);
			assert.deepEqual(
				actual,
				expected.map(
					(line) =>
						palette.getFgAnsi("userMessageText") +
						palette.getBgAnsi("userMessageBg") +
						line +
						"\x1b[49m\x1b[39m",
				),
			);
			assert.deepEqual(actual.map(plain), expected.map(plain));
			assert.doesNotMatch(plain(actual[0] ?? ""), /[─│]/u);
			assert.deepEqual(actual.map(visibleWidth), expected.map(visibleWidth));
			assert.deepEqual(surfaced.getCursor(), reference.getCursor());
			assert.equal(surfaced.getExpandedText(), reference.getExpandedText());
			return actual;
		},
	};
}

for (const mode of ["truecolor", "256color"]) {
	test(`${mode}: composer matches user tokens without changing any native rows or cursor markers`, () => {
		const editors = pair(loadThemeFromPath(path, mode));
		for (const editor of [editors.reference, editors.surfaced]) {
			editor.focused = true;
			editor.setText("No prefix here\n世界 🧊 é\n    intentional indentation\n" + "─".repeat(80));
		}
		for (const width of [4, 10, 40, 80, 120, 160, 40]) {
			const lines = editors.check(width);
			assert.ok(lines.some((line) => line.includes(CURSOR_MARKER)));
		}
	});
}

test("surface uses the current palette after theme changes, including light themes", () => {
	const editors = pair();
	for (const name of ["dark", "light", "obsidian-ice"]) {
		editors.setPalette(name === "obsidian-ice" ? loadThemeFromPath(path, "truecolor") : getThemeByName(name));
		for (const width of [1, 2, 40, 80]) editors.check(width);
	}
	assert.deepEqual(editors.surfaced.render(0), []);
});

test("surface preserves native autocomplete selection, content and geometry", async () => {
	const editors = pair();
	const provider = {
		async getSuggestions() {
			return {
				prefix: "/",
				items: [
					{ value: "help", label: "help", description: "menu untouched" },
					{ value: "settings", label: "settings", description: "another item" },
				],
			};
		},
		applyCompletion() {
			return { lines: ["/help"], cursorLine: 0, cursorCol: 5 };
		},
	};
	for (const editor of [editors.reference, editors.surfaced]) {
		editor.setAutocompleteProvider(provider);
		editor.handleInput("/");
		editor.handleInput("\t");
	}
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.ok(editors.surfaced.isShowingAutocomplete());
	for (const width of [40, 80, 120]) editors.check(width);
	for (const editor of [editors.reference, editors.surfaced]) editor.handleInput("\x1b[B");
	const rows = editors.check(80);
	assert.ok(rows.some((line) => line.includes("another item")));
	assert.ok(
		rows.some((line) => line.includes("\x1b[36m")),
		"native selection styling survives",
	);
	for (const editor of [editors.reference, editors.surfaced]) editor.handleInput("\x1b");
});

test("surface preserves shell hints, paste, undo/redo and overflow across redraws", () => {
	const editors = pair();
	for (const editor of [editors.reference, editors.surfaced]) {
		editor.setText("!pwd");
		editor.handleInput("\x1b[200~\npasted 世界\x1b[201~");
		editor.handleInput("\x1a");
	}
	const rows = editors.check(80).map(plain);
	assert.match(rows[0]!, /^  shell .*ctrl\+z undo · ctrl\+y redo  $/);
	assert.equal(rows.at(-1), " ".repeat(80));
	for (const editor of [editors.reference, editors.surfaced]) editor.handleInput("\x19");
	editors.check(80);
	assert.match(editors.surfaced.getExpandedText(), /pasted 世界/);
	for (const editor of [editors.reference, editors.surfaced]) {
		editor.setText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
	}
	for (const width of [10, 40, 80, 160]) {
		const border = plain(editors.check(width)[0]!);
		assert.match(border, /↑/);
		if (width >= 40) assert.match(border, /more/);
	}
});
