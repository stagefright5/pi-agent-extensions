import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { CURSOR_MARKER, renderFakeCursor, visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";
import { getNativeAutocompleteHeight } from "./editor-compat.ts";
import { composerPalette, truecolorAfter } from "./composer-style.ts";
import { registerStatusAction, statusLineChannel } from "./status-line.ts";

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
		assert.equal(plain(rows.at(-1)!).trim(), "", "the footer holds no input hints while drafting");
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

test("themed composer: padded draft bar, mode rail, footer strip, hint placeholder, and a display-only legend", async () => {
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
	let rows = editor.render(80);
	// full pad · draft · full pad · one-row footer (the screen's last row)
	assert.ok(rows.every((row) => visibleWidth(row) === 80));
	const surfaceBg = palette.getBgAnsi("userMessageBg");
	for (const index of [0, 1, 2]) assert.ok(rows[index]!.includes(surfaceBg), `row ${index} is on the draft surface`);
	assert.equal(text(rows[0]!), " ".repeat(80), "full top padding row");
	assert.equal(text(rows[2]!), " ".repeat(80), "full bottom padding row, directly on the footer");
	assert.ok(rows[3]!.includes(composerPalette(palette).footer), "the footer is a single darker row");
	assert.ok(!rows.some((row) => /[\u2580\u2584]/u.test(text(row))), "no half-block glyphs remain");
	assert.deepEqual(
		rows.map((row) => text(row)[0]),
		[" ", "\u258e", " ", " "],
		"the rail marks only the draft rows",
	);
	assert.match(
		text(rows[1]!),
		/^\u258e {2,}\/ commands {2}\$ skills {2}! shell {2}@ files $/u,
		"hints, no prompt text",
	);
	assert.ok(rows[1]!.includes(CURSOR_MARKER), "the placeholder keeps the hardware cursor marker");
	assert.equal(text(rows[3]!).trim(), "", "nothing to say in the footer yet");
	assert.ok(rows[1]!.includes(palette.fg("accent", "\u258e")));
	editor.setText("!ls");
	rows = editor.render(80);
	assert.ok(rows[1]!.includes(palette.fg("bashMode", "\u258e")), "shell mode recolors the rail");
	assert.match(text(rows[3]!), /^ shell +$/u);
	assert.equal(editor.getText(), "!ls", "chrome never enters the draft");
	// Clicks on the extra padding/footer rows land on the native bottom border, not past it.
	for (const y of [2, 3]) editor.handleMouse(click(5, y, rows.length));
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

test("a lent status line fills the footer only while the focused composer draws it", async (t) => {
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
	const channel = statusLineChannel();
	const lent: string[][] = [];
	channel.render = (width, extras = []) => {
		lent.push(extras.map((extra) => plain(extra)));
		const left = ["~/repo · main", ...extras.map((extra) => plain(extra)).filter(Boolean)].join("  ");
		const right = "Claude · high · 7%/1000k · $1.000";
		return left + " ".repeat(Math.max(1, width - left.length - right.length)) + right;
	};
	t.after(() => {
		channel.render = undefined;
		channel.host = undefined;
	});
	const footer = () => plain(editor.render(80).at(-1)!);

	editor.focused = false;
	assert.equal(footer().trim(), "", "unfocused: the status bar keeps its own row");
	assert.equal(editor.hostsStatusLine(), false);

	editor.focused = true;
	assert.match(footer(), /^ ~\/repo · main +Claude · high · 7%\/1000k · \$1\.000 $/u);
	assert.equal(editor.hostsStatusLine(), true);
	assert.equal(channel.host, editor);
	assert.deepEqual(lent.at(-1), ["", ""], "no mode or hints while drafting");
	for (const width of [20, 80, 160]) assert.equal(visibleWidth(editor.render(width).at(-1)!), width);

	editor.setText("!ls");
	assert.match(footer(), /^ ~\/repo · main {2}shell +Claude/u, "<dir> then <mode>");
	editor.insertTextAtCursor(" -la");
	editor.handleInput("\x1a");
	assert.match(footer(), /^ ~\/repo · main {2}shell {2}⌃Z undo {2}⌃Y redo +Claude/u, "<dir> <mode> <hints>");
	const row = editor.render(80).at(-1)!;
	const footerBg = composerPalette(palette).footer;
	const fg = truecolorAfter(row, "\x1b[38;2;")!;
	const bg = truecolorAfter(footerBg, "\x1b[48;2;")!;
	const text = truecolorAfter(palette.getFgAnsi("userMessageText"), "\x1b[38;2;")!;
	const distance = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0);
	assert.ok(distance(fg, bg) < distance(text, bg) * 0.7, "footer text sits closer to its bar");

	editor.setText(Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
	editor.handleInput("\x1b[5~");
	footer();
	assert.match(lent.at(-1)?.[1] ?? "", /↓ \d+ more/u, "overflow stays readable after the directory");
});

test("clicking a clickable status in the hosted footer runs its action; other clicks fall through", async (t) => {
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
	const channel = statusLineChannel();
	const left = "~/repo · main · ";
	const jobs = "● 1 running";
	// Like the status bar: regions are relative to the start of the lent line.
	channel.render = (width) => {
		channel.regions = [{ id: "bg-bash", start: left.length, end: left.length + jobs.length }];
		return (left + jobs).padEnd(width);
	};
	let opened = 0;
	const unregister = registerStatusAction("bg-bash", { label: "jobs", activate: () => opened++ });
	t.after(() => {
		unregister();
		channel.render = undefined;
		channel.host = undefined;
		channel.regions = undefined;
	});
	editor.setText("draft");
	const rows = editor.render(80);
	const footerY = rows.length - 1;
	const line = plain(rows[footerY]!);
	const lead = line.indexOf("~");
	assert.equal(lead, 1, "the hosted line starts after the inset");
	const at = (x: number, type: TuiMouseEvent["type"] = "click"): TuiMouseEvent => ({
		...click(x, footerY, rows.length),
		type,
	});
	const jobsX = line.indexOf("●");
	assert.deepEqual(editor.handleMouse(at(jobsX, "press")), { handled: true, render: false }, "press is swallowed");
	assert.equal(opened, 0, "press alone does not open");
	assert.deepEqual(editor.handleMouse(at(jobsX)), { handled: true, render: false });
	assert.equal(opened, 1);
	assert.deepEqual(editor.handleMouse(at(lead + left.length + jobs.length - 1)), { handled: true, render: false });
	assert.equal(opened, 2, "the last column of the status is inside the region");
	editor.handleMouse(at(lead + left.length - 1));
	editor.handleMouse(at(lead + left.length + jobs.length));
	editor.handleMouse(click(jobsX, footerY - 1, rows.length));
	assert.equal(opened, 2, "columns around the status and other rows fall through");
	assert.equal(editor.getText(), "draft", "a status click never edits the draft");
	editor.focused = false;
	editor.render(80);
	assert.equal(editor.handleMouse(at(jobsX))?.render, undefined, "unfocused: the composer no longer hosts it");
	assert.equal(opened, 2);
});
