import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { UndoRedoEditor } from "./index.ts";

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
const SELECTED = "\x1b[7m";

function make(width: number, copyOnSelect = true) {
	const copied: string[] = [];
	const flashes: string[] = [];
	const tui = {
		terminal: { rows: 40, columns: width },
		requestRender() {},
		getCopyOnSelect: () => copyOnSelect,
		flash: (message: string) => flashes.push(message),
	} as unknown as TUI;
	const editor = new UndoRedoEditor(
		tui,
		theme,
		new KeybindingsManager(),
		() => false,
		undefined,
		identity,
		undefined,
		undefined,
		async (text) => {
			copied.push(text);
		},
	);
	editor.setPaddingX(1);
	editor.focused = true;
	const mouse = (type: TuiMouseEvent["type"], x: number, y: number, clickCount?: number) =>
		editor.handleMouse({
			type,
			button: "left",
			x,
			y,
			screenX: x,
			screenY: y,
			width,
			height: 10,
			shift: false,
			alt: false,
			ctrl: false,
			...(clickCount ? { clickCount } : {}),
		});
	const drag = (from: [number, number], to: [number, number]) => {
		assert.deepEqual(mouse("press", ...from), { capture: true, focus: true });
		mouse("drag", ...to);
		mouse("release", ...to);
	};
	const settle = () => new Promise((resolve) => setImmediate(resolve));
	return { editor, copied, flashes, mouse, drag, settle, render: () => editor.render(width) };
}

test("dragging across the inset selects and copies source text only", async () => {
	const t = make(20);
	t.editor.setText("hello world");
	t.render();
	t.drag([0, 1], [19, 1]);
	await t.settle();
	assert.deepEqual(t.copied, ["hello world"]);
	assert.deepEqual(t.flashes, ["Copied!"]);
	const row = t.render()[1]!;
	assert.ok(row.startsWith(` ${SELECTED}`), "left inset stays unhighlighted");
	assert.equal(plain(row), plain(t.editor.render(20)[1]!));
	assert.equal(t.editor.getText(), "hello world");
});

test("wrapped multi-line selections copy logical text without wrap breaks or insets", async () => {
	const t = make(12);
	t.editor.setText("alpha beta gamma\nsecond line");
	const rows = t.render();
	assert.ok(rows.length > 4, "text wraps");
	t.drag([0, 1], [11, 99]);
	await t.settle();
	assert.deepEqual(t.copied, ["alpha beta gamma\nsecond line"]);
	t.drag([6, 1], [3, 1]); // reverse direction, partial row
	await t.settle();
	assert.equal(t.copied.at(-1), "pha");
});

test("double and triple click select a word and a logical line", async () => {
	const t = make(40);
	t.editor.setText("first line\nalpha beta gamma");
	t.render();
	t.mouse("click", 8, 2, 2);
	t.mouse("click", 8, 2, 3);
	await t.settle();
	assert.deepEqual(t.copied, ["beta", "alpha beta gamma"]);
});

test("single click still positions the cursor; typing clears selection normally", async () => {
	const t = make(40);
	t.editor.setText("abc def");
	t.render();
	t.mouse("press", 3, 1);
	t.mouse("release", 3, 1);
	t.mouse("click", 3, 1, 1);
	assert.deepEqual(t.editor.getCursor(), { line: 0, col: 2 });
	t.drag([1, 1], [4, 1]);
	assert.ok(t.render()[1]!.includes(SELECTED));
	t.editor.handleInput("X");
	assert.equal(t.editor.getText(), "abXc def");
	assert.ok(!t.render()[1]!.includes(SELECTED));
});

test("without copy-on-select, the copy key copies once and keeps the draft", async () => {
	const t = make(40, false);
	t.editor.setText("keep this draft");
	t.render();
	t.drag([1, 1], [5, 1]);
	await t.settle();
	assert.deepEqual(t.copied, []);
	t.editor.handleInput("\x03");
	await t.settle();
	assert.deepEqual(t.copied, ["keep"]);
	assert.equal(t.editor.getText(), "keep this draft");
});

test("collapsed paste markers copy their pasted contents", async () => {
	const t = make(60);
	const payload = "pasted line\n".repeat(12);
	t.editor.handleInput(`\x1b[200~${payload}\x1b[201~`);
	assert.match(t.editor.getText(), /\[paste #1/);
	t.render();
	t.drag([0, 1], [59, 99]);
	await t.settle();
	assert.deepEqual(t.copied, [payload]);
});
