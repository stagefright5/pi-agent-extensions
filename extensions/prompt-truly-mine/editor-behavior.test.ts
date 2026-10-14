import assert from "node:assert/strict";
import test from "node:test";
import { getKeybindings, setKeybindings, TuiMainScreen, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
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
const terminal: Terminal = {
	rows: 40,
	columns: 80,
	kittyProtocolActive: false,
	start() {},
	stop() {},
	async drainInput() {},
	write() {},
	moveBy() {},
	hideCursor() {},
	showCursor() {},
	clearLine() {},
	clearFromCursor() {},
	clearScreen() {},
	setTitle() {},
	setProgress() {},
	setProgramStatus() {},
};
const make = (kb = new KeybindingsManager()) => new UndoRedoEditor(new TuiMainScreen(terminal), theme, kb, () => false);
const paste = (editor: UndoRedoEditor, text: string) => editor.handleInput(`\x1b[200~${text}\x1b[201~`);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

for (const action of ["delete", "delete-first", "replace", "round-trip"] as const) {
	test(`large paste contents survive ${action}, undo and redo`, () => {
		const editor = make();
		const first = "first paste\n".repeat(12);
		const second = "second paste\n".repeat(13);
		paste(editor, first);
		paste(editor, second);
		const original = editor.getText();
		const cursor = editor.getCursor();
		if (action === "delete") editor.handleInput("\x7f");
		else if (action === "delete-first") {
			editor.handleInput("\x01");
			editor.handleInput("\x1b[C");
			cursor.col = editor.getCursor().col;
			editor.handleInput("\x7f");
		} else if (action === "replace") editor.setText("replacement");
		else editor.setText(editor.getText());
		if (action === "round-trip") {
			assert.equal(editor.getExpandedText(), first + second);
			return;
		}
		const after = editor.getExpandedText();
		editor.handleInput("\x1a");
		assert.equal(editor.getText(), original);
		assert.equal(editor.getExpandedText(), first + second);
		assert.deepEqual(editor.getCursor(), cursor);
		editor.handleInput("\x19");
		assert.equal(editor.getExpandedText(), after);
		editor.handleInput("\x1a");
		editor.handleInput("\x05");
		paste(editor, "third\n".repeat(14));
		assert.equal(editor.getExpandedText(), first + second + "third\n".repeat(14));
	});
}

test("asynchronous single-match completion has its own undo boundary and invalidates redo", async () => {
	const editor = make();
	editor.setText("src");
	editor.insertTextAtCursor(" extra");
	editor.handleInput("\x1a");
	editor.setAutocompleteProvider({
		async getSuggestions() {
			return { prefix: "src", items: [{ value: "src/file.ts", label: "src/file.ts" }] };
		},
		applyCompletion() {
			return { lines: ["src/file.ts "], cursorLine: 0, cursorCol: 12 };
		},
	});
	editor.handleInput("\t");
	await tick();
	assert.equal(editor.getText(), "src/file.ts ");
	editor.handleInput("\x19");
	assert.equal(editor.getText(), "src/file.ts ");
	editor.handleInput("\x1a");
	assert.equal(editor.getText(), "src");
	editor.handleInput("\x19");
	assert.equal(editor.getText(), "src/file.ts ");
	editor.handleInput("\x1a");
	editor.handleInput("\x1a");
	assert.equal(editor.getText(), "");
});

test("mouse autocomplete selection is undoable and cursor clicks break typing groups", async () => {
	const editor = make();
	editor.setAutocompleteProvider({
		async getSuggestions() {
			return {
				prefix: "/",
				items: [
					{ value: "help", label: "help" },
					{ value: "settings", label: "settings" },
				],
			};
		},
		applyCompletion() {
			return { lines: ["/help "], cursorLine: 0, cursorCol: 6 };
		},
	});
	editor.handleInput("/");
	await tick();
	editor.render(80);
	editor.handleMouse({
		type: "click",
		button: "left",
		x: 2,
		y: 3,
		screenX: 2,
		screenY: 3,
		width: 80,
		height: 6,
		shift: false,
		alt: false,
		ctrl: false,
	});
	assert.equal(editor.getText(), "/help ");
	editor.handleInput("\x1a");
	assert.equal(editor.getText(), "/");
	const typed = make();
	for (const char of "abc") typed.handleInput(char);
	typed.render(80);
	typed.handleMouse({
		type: "click",
		button: "left",
		x: 0,
		y: 1,
		screenX: 0,
		screenY: 1,
		width: 80,
		height: 3,
		shift: false,
		alt: false,
		ctrl: false,
	});
	typed.handleInput("X");
	assert.equal(typed.getText(), "Xabc");
	typed.handleInput("\x1a");
	assert.equal(typed.getText(), "abc");
	assert.deepEqual(typed.getCursor(), { line: 0, col: 0 });
});

test("backslash-Enter submission with remapped submit cannot resurrect the sent draft", () => {
	const previous = getKeybindings();
	const kb = new KeybindingsManager({ "tui.input.submit": "shift+enter", "tui.input.newLine": "enter" });
	setKeybindings(kb);
	try {
		const editor = make(kb);
		editor.setText("sent draft\\");
		let submitted = "";
		editor.onSubmit = (text) => {
			submitted = text;
		};
		editor.handleInput("\r");
		assert.equal(submitted, "sent draft");
		editor.handleInput("\x1a");
		assert.equal(editor.getText(), "");
	} finally {
		setKeybindings(previous);
	}
});

test("undo cancels outstanding completion before it can overwrite the restored draft", async () => {
	const editor = make();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	editor.setText("src");
	editor.setAutocompleteProvider({
		async getSuggestions() {
			await gate;
			return { prefix: "src", items: [{ value: "file", label: "file" }] };
		},
		applyCompletion() {
			throw new Error("Stale completion must not apply");
		},
	});
	editor.handleInput("\t");
	await tick();
	editor.handleInput("\x1a");
	release();
	await tick();
	assert.equal(editor.getText(), "");
});

test("plain, Kitty and modifyOtherKeys printable typing share undo grouping", () => {
	for (const encode of [
		(c: string) => c,
		(c: string) => `\x1b[${c.codePointAt(0)}u`,
		(c: string) => `\x1b[27;1;${c.codePointAt(0)}~`,
	]) {
		const editor = make();
		for (const character of "abc") editor.handleInput(encode(character));
		assert.equal(editor.getText(), "abc");
		editor.handleInput("\x1a");
		assert.equal(editor.getText(), "");
		editor.handleInput("\x19");
		assert.equal(editor.getText(), "abc");
	}
});

test("wide graphemes fit even one-column composer viewports", () => {
	const editor = make();
	editor.focused = true;
	editor.setText("世界 🧊 é");
	for (const width of [0, 1, 2, 3, 4, 10]) {
		for (const row of editor.render(width)) assert.ok(visibleWidth(row) <= width, `overflow at ${width}`);
	}
});
