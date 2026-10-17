import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { CURSOR_MARKER, renderFakeCursor, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";
import { getNativeAutocompleteHeight } from "./editor-compat.ts";
import { composerPalette } from "./composer-style.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const click = (x: number, y: number, height: number): TuiMouseEvent => ({
	type: "click",
	button: "left",
	x,
	y,
	screenX: x,
	screenY: y,
	width: 80,
	height,
	shift: false,
	alt: false,
	ctrl: false,
});
function make() {
	const editor = new UndoRedoEditor(tui, theme, new KeybindingsManager(), () => false);
	editor.setPaddingX(1);
	editor.focused = true;
	return editor;
}

test("one-cell native padding is symmetric, width-safe, and never enters submitted text", () => {
	const editor = make();
	for (const width of [4, 10, 40, 80]) {
		editor.setText("x".repeat(width - 2));
		assert.equal(
			plain(editor.render(width)[1]!).replaceAll(CURSOR_MARKER, "").replaceAll(renderFakeCursor(" "), " "),
			` ${"x".repeat(width - 2)} `,
		);
	}
	editor.setText("世界 🧊 é");
	for (const width of [0, 1, 2, 3, 4, 10, 80]) {
		for (const row of editor.render(width)) assert.ok(visibleWidth(row) <= width);
	}
	let submitted = "";
	editor.onSubmit = (text) => {
		submitted = text;
	};
	editor.handleInput("\r");
	assert.equal(submitted, "世界 🧊 é");
});

test("suggestions grow above the bottom-anchored cursor; keyboard and mouse coordinates still work", async () => {
	const editor = make();
	let count = 3;
	editor.setAutocompleteProvider({
		async getSuggestions() {
			return {
				prefix: "/",
				items: Array.from({ length: count }, (_, i) => ({ value: `item${i}`, label: `item${i}` })),
			};
		},
		applyCompletion(_lines, _line, _col, item) {
			return { lines: [`/${item.value} `], cursorLine: 0, cursorCol: item.value.length + 2 };
		},
	});
	editor.setText("/");
	const closed = editor.render(80);
	const fromBottom = (rows: string[]) => rows.length - rows.findIndex((line) => line.includes(CURSOR_MARKER));
	for (count of [3, 8, 2]) {
		editor.handleInput("\t");
		await tick();
		const rows = editor.render(80);
		assert.equal(fromBottom(rows), fromBottom(closed));
		assert.match(plain(rows[0]!), /item0/);
		assert.match(
			plain(rows.at(-1)!),
			/^ +\/ commands {2}\$ skills {2}! shell {2}@ files $/u,
			"bottom row holds only hints",
		);
		for (const width of [4, 10, 80, 120]) {
			for (const row of editor.render(width)) assert.ok(visibleWidth(row) <= width);
		}
		editor.handleInput("\x1b");
		assert.equal(fromBottom(editor.render(80)), fromBottom(closed));
	}
	editor.handleInput("\t");
	await tick();
	let rows = editor.render(80);
	// The prompt is below the two menu rows and the header.
	editor.handleMouse(click(1, rows.length - 2, rows.length));
	assert.deepEqual(editor.getCursor(), { line: 0, col: 0 });
	// Move back to the end and open the menu again (cursor movement may cancel it).
	editor.handleInput("\x05");
	editor.handleInput("\x1b");
	editor.handleInput("\t");
	await tick();
	rows = editor.render(80);
	editor.handleMouse(click(3, 1, rows.length));
	assert.equal(editor.getText(), "/item1 ");
	editor.handleInput("\x1a");
	assert.equal(editor.getText(), "/");
	editor.handleInput("\t");
	await tick();
	editor.handleInput("\x1b[B");
	editor.handleInput("\t");
	assert.equal(editor.getText(), "/item1 ");
});

test("unknown native menu geometry falls back without reordering arbitrary rows", () => {
	const editor = make();
	Reflect.set(editor, "autocompleteState", "regular");
	for (const [menu, content] of [
		["2", 1],
		[2, -1],
		[99, 1],
		[2, 1.5],
		[NaN, 1],
	]) {
		Reflect.set(editor, "renderedAutocompleteHeight", menu);
		Reflect.set(editor, "renderedVisibleLineCount", content);
		assert.equal(getNativeAutocompleteHeight(editor, 5), 0);
	}
});

test("exiting Pi erases the cursor with the surface color instead of a terminal-default hole", async () => {
	const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const surface = getThemeByName("dark");
	const cell = surface.style(" ", { fg: "userMessageText", bg: "userMessageBg" });
	// A regular-screen renderer behind Pi's forwarding proxy, with the native exit sequence.
	const writes: string[] = [];
	class MainScreen {
		mode = "regular";
		terminal = {
			rows: 40,
			columns: 80,
			write(data: string) {
				writes.push(data);
			},
		};
		requestRender() {}
		beforeTerminalStop(_options: unknown) {
			this.terminal.write(" ");
			this.terminal.write("\x1b[3B");
		}
		stop() {
			this.beforeTerminalStop({});
		}
	}
	const renderer = new MainScreen();
	const nativeWrite = renderer.terminal.write;
	const proxy = new Proxy({} as object, {
		get: (_t, key) => {
			const value = Reflect.get(renderer, key, renderer);
			return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, renderer, args) : value;
		},
		set: (_t, key, value) => Reflect.set(renderer, key, value, renderer),
		getPrototypeOf: () => Reflect.getPrototypeOf(renderer),
	});
	const editor = new UndoRedoEditor(
		proxy as TUI,
		theme,
		new KeybindingsManager(),
		() => false,
		undefined,
		identity,
		() => surface,
	);
	editor.focused = true;
	editor.setText("hello");
	editor.render(80);
	editor.render(80); // Idempotent installation.
	renderer.stop();
	assert.deepEqual(writes, [cell, "\x1b[3B"]);
	assert.equal(renderer.terminal.write, nativeWrite, "terminal.write is restored");
	// Unfocused (e.g. an overlay owns the cursor): native behavior is untouched.
	writes.length = 0;
	editor.focused = false;
	editor.render(80);
	renderer.stop();
	assert.deepEqual(writes, [" ", "\x1b[3B"]);
	// Fullscreen renderers are never patched.
	renderer.mode = "fullscreen";
	assert.equal(Object.hasOwn(new MainScreen(), "beforeTerminalStop"), false);
});

test("themed composer: half-row padded bars, mode rail, footer strip, placeholder, and a display-only legend", async () => {
	const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const palette = getThemeByName("dark");
	const editor = new UndoRedoEditor(
		tui,
		theme,
		new KeybindingsManager(),
		() => false,
		undefined,
		identity,
		() => palette,
	);
	editor.setPaddingX(1);
	editor.focused = true;
	const [fakeStart = "", fakeEnd = ""] = renderFakeCursor("\u0000").split("\u0000");
	const text = (row: string) =>
		plain(row).replaceAll(CURSOR_MARKER, "").replaceAll(fakeStart, "").replaceAll(fakeEnd, "");
	const surfaceFg = palette.getBgAnsi("userMessageBg").replace("[48;", "[38;");
	let rows = editor.render(80);
	// ▄ half pad · draft · ▀ surface over footer · footer labels · ▀ footer half pad
	assert.deepEqual(
		rows.map((row) => text(row)[1]),
		["\u2584", " ", "\u2580", " ", "\u2580"],
	);
	assert.ok(rows.every((row) => visibleWidth(row) === 80));
	assert.ok(rows[0]!.startsWith(surfaceFg), "top half pad is drawn in the surface color");
	assert.ok(!rows[0]!.includes("\x1b[48;"), "its other half is the terminal background");
	assert.ok(
		rows[2]!.includes(surfaceFg) && rows[2]!.includes(composerPalette(palette).footer),
		"draft bar meets the footer",
	);
	assert.deepEqual(
		rows.map((row) => text(row)[0]),
		["\u2584", "\u258e", "\u258e", "\u258e", "\u2580"],
		"the rail runs from the draft through the footer",
	);
	assert.match(text(rows[1]!), /^\u258e Ask Pi anything +$/u);
	assert.ok(rows[1]!.includes(CURSOR_MARKER), "the placeholder keeps the hardware cursor marker");
	assert.match(text(rows[3]!), /^\u258e +\/ commands {2}\$ skills {2}! shell {2}@ files $/u);
	assert.ok(rows[1]!.includes(palette.fg("accent", "\u258e")));
	editor.setText("!ls");
	rows = editor.render(80);
	assert.ok(rows[1]!.includes(palette.fg("bashMode", "\u258e")), "shell mode recolors the rail");
	assert.match(text(rows[3]!), /^\u258eshell +\/ commands/u);
	assert.equal(editor.getText(), "!ls", "chrome never enters the draft");
	// Clicks on the extra padding/footer rows land on the native bottom border, not past it.
	for (const y of [2, 3, 4]) editor.handleMouse(click(5, y, rows.length));
	assert.equal(editor.getText(), "!ls");
	// Autocomplete: the legend row swallows clicks instead of reaching native hit testing.
	editor.setText("");
	editor.setAutocompleteProvider({
		async getSuggestions() {
			return { prefix: "/", items: [{ value: "help", label: "help", description: "[u] Show help" }] };
		},
		applyCompletion() {
			return { lines: ["/help"], cursorLine: 0, cursorCol: 5 };
		},
	});
	editor.handleInput("/");
	for (let i = 0; i < 5; i++) await tick();
	assert.ok(editor.isShowingAutocomplete());
	rows = editor.render(80);
	assert.match(text(rows[0]!), /^ › help {6}Show help +$/u, "names align with the draft, scope tag removed");
	assert.match(plain(rows[1]!), /1\/1/u);
	assert.deepEqual(editor.handleMouse(click(40, 1, rows.length)), { handled: true });
	assert.equal(editor.getText(), "/");
});
