import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";
import { composerPalette, FOOTER_TEXT_SOFTENING, softenForeground } from "./composer-style.ts";

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
			const expectedComposer = expected.slice(Number(Reflect.get(reference, "menuHeight")));
			const composer = actual.slice(Number(Reflect.get(surfaced, "menuHeight")));
			const open = palette.getFgAnsi("userMessageText") + palette.getBgAnsi("userMessageBg");
			const close = "\x1b[49m\x1b[39m";
			const footer = softenForeground(
				palette.getFgAnsi("userMessageText") + composerPalette(palette).footer,
				composerPalette(palette).footer,
				FOOTER_TEXT_SOFTENING,
			);
			if (width < 3) {
				// Compact viewport: no padding rows or footer strip, just the native rows on the surface.
				assert.deepEqual(
					composer,
					expectedComposer.map((line) => open + line + close),
				);
			} else {
				// [top pad, ...draft, bottom pad, footer] vs native [top, ...draft, bottom].
				assert.equal(composer.length, expectedComposer.length + 1);
				const [top, ...rest] = composer;
				const nativeTop = expectedComposer[0]!;
				assert.equal(top, open + nativeTop + close, "the top padding row is the native top row on the surface");
				const draft = rest.slice(0, expectedComposer.length - 2);
				draft.forEach((line, index) => {
					const native = expectedComposer[index + 1]!;
					if (index === 0 && surfaced.getText() === "" && plain(line).includes("/ commands")) {
						assert.equal(visibleWidth(line), visibleWidth(native), "placeholder keeps the row width");
						return;
					}
					assert.equal(line, open + native + close, `draft row ${index} must stay byte-for-byte native`);
				});
				const [joint, strip] = rest.slice(-2);
				assert.equal(
					joint,
					open + " ".repeat(width) + close,
					"a full surface row joins the draft to the footer",
				);
				assert.ok(strip!.startsWith(footer) && strip!.endsWith(close), "footer keeps its strip");
				assert.equal(plain(strip!).trimEnd(), plain(expectedComposer.at(-1)!).trimEnd());
				for (const line of composer) assert.equal(visibleWidth(line), width);
			}
			assert.doesNotMatch(plain(composer[0] ?? ""), /[─│]/u);
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
	const menu = composerPalette(getThemeByName("dark"));
	const panel = rows.slice(0, 3);
	assert.deepEqual(
		panel.map((line) => plain(line).trimEnd()),
		["  help      menu untouched", "› settings  another item", panel.map(plain)[2]!.trimEnd()],
	);
	assert.match(plain(panel[2]!), /^ {2}2\/2 +↑↓ select {2}⇥ complete {2}esc close$/u);
	assert.ok(panel[1]!.includes(menu.menuSelected), "the selected row is visibly highlighted");
	assert.ok(!panel[0]!.includes(menu.menuSelected) && panel[0]!.includes(menu.menu));
	for (const line of panel) assert.equal(visibleWidth(line), 80);
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
	assert.equal(rows[0]!, " ".repeat(80));
	assert.match(rows.at(-1)!, /^shell +⌃Z undo {2}⌃Y redo$/u);
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
