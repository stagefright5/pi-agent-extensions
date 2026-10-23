import assert from "node:assert/strict";
import test from "node:test";
import {
	stripTerminalSequences,
	TuiAltScreen,
	TuiMainScreen,
	visibleWidth,
	type Component,
	type Terminal,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { documentPopup } from "./document.ts";
import { Popup, type PopupBody, type PopupHost, type PopupOptions } from "./popup.ts";
import { dark, keybindings, light, mouse, setThemeInstance } from "./harness.test.helper.ts";

const plain = (lines: string[]) => lines.map(stripTerminalSequences);

function host(rows = 40, theme = dark) {
	const state = { rows, theme, renders: 0 };
	const value: PopupHost = {
		rows: () => state.rows,
		theme: () => state.theme,
		requestRender: () => {
			state.renders++;
		},
		keybindings,
	};
	return { host: value, state };
}

class Recorder implements PopupBody {
	keys: string[] = [];
	events: TuiMouseEvent[] = [];
	focused = false;
	disposed = 0;
	lines: string[];
	constructor(lines = ["alpha", "beta", "gamma"]) {
		this.lines = lines;
	}
	render(): string[] {
		return this.lines;
	}
	invalidate(): void {}
	handleInput(data: string): void {
		this.keys.push(data);
	}
	handleMouse(event: TuiMouseEvent) {
		this.events.push(event);
		return event.type === "press" ? { capture: true } : { handled: true };
	}
	dispose(): void {
		this.disposed++;
	}
}

test("every width and height stays inside the popup's bounds and degrades in tiers", () => {
	const options: PopupOptions = {
		kind: "Kind",
		title: "Title 世界 🧊",
		meta: "meta",
		subtitle: "/tmp/sub\ntitle",
		actions: [
			{ value: "a", key: "a", label: "approve", primary: true },
			{ value: "c", key: "c", label: "copy", align: "right" },
		],
	};
	for (const rows of [1, 2, 3, 4, 5, 8, 12, 24, 60]) {
		for (let width = 0; width <= 200; width += width < 30 ? 1 : 17) {
			for (const fit of [false, true]) {
				const { host: h } = host(rows);
				const popup = new Popup(
					new Recorder(Array.from({ length: 50 }, (_, i) => `line ${i} 世界`)),
					{
						...options,
						height: { fit, max: 0.8 },
					},
					h,
				);
				const lines = popup.render(width);
				const max = Math.max(1, Math.floor(rows * 0.8));
				assert.ok(lines.length <= max, `${rows}x${width}: ${lines.length} > ${max}`);
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `${rows}x${width}: ${line}`);
				const layout = popup.layout;
				if (width > 0) {
					assert.ok(layout);
					assert.equal(layout.shadow, width >= 24 && max >= 8, "shadow tier");
					if (!layout.shadow && width >= 24) assert.ok(max < 8);
					if (layout.border) assert.ok(layout.frameWidth >= 12);
				}
			}
		}
	}
});

test("frame: rounded border with title and meta, panel-filled card including corners, footer separator, offset shadow", () => {
	const { host: h } = host(20);
	const popup = new Popup(
		new Recorder(),
		{
			kind: "Plan review",
			title: "Add dialogs",
			meta: "iteration 2",
			actions: [
				{ value: "a", key: "a", label: "approve", primary: true },
				{ value: "x", key: "tui.select.cancel", keyText: "esc", label: "close", align: "right" },
			],
			height: { fit: true },
		},
		h,
	);
	const lines = popup.render(60);
	const text = plain(lines);
	assert.match(text[0]!, /^╭─ Plan review {2}Add dialogs ─+ iteration 2 ─╮ $/u);
	assert.match(text[1]!, /^│ {2}alpha +│▌$/u);
	assert.match(text.at(-4)!, /^├─+┤▌$/u);
	assert.match(text.at(-3)!, /^│ {2} a approve +esc close {2}│▌$/u);
	assert.match(text.at(-2)!, /^╰─+╯▌$/u);
	assert.match(text.at(-1)!, /^ ▀+▘$/u);
	for (const line of lines) assert.equal(visibleWidth(line), 60);
	// Interior rows share one panel background that is not the composer surface colour.
	// Truecolor (48;2;r;g;b) or, without COLORTERM, 256-colour (48;5;n).
	const bg = (line: string) => /\u001b\[48;[25];[\d;]+m/u.exec(line)?.[0];
	const panel = bg(lines[1]!);
	assert.ok(panel);
	for (const line of lines.slice(0, -1)) assert.equal(bg(line), panel);
	// The corners sit on the panel too: the background starts before the corner glyph, so no notch.
	for (const line of [lines[0]!, lines.at(-2)!])
		assert.ok(line.indexOf(panel) < line.search(/[╭╰]/u), "corner cells are panel-filled");
	assert.notEqual(panel, dark.getBgAnsi("userMessageBg"));
	assert.equal(popup.layout?.bodyTop, 1);
	assert.equal(popup.layout?.bodyLeft, 3);
});

test("height-aware bodies get the exact body rectangle; fit shrinks to the natural height", () => {
	const seen: Array<[number, number]> = [];
	const body: PopupBody = {
		render: () => [],
		invalidate() {},
		naturalHeight: () => 4,
		renderBody(width, height) {
			seen.push([width, height]);
			return Array.from({ length: height }, (_, i) => `row ${i}`);
		},
	};
	const { host: h } = host(40);
	const popup = new Popup(body, { title: "t", height: { fit: true } }, h);
	const lines = popup.render(50);
	assert.deepEqual(seen.at(-1), [43, 4]);
	assert.equal(lines.length, 4 + 2 + 1);
	assert.deepEqual(popup.bodySize(), { width: 43, height: 4 });
	const full = new Popup(body, { title: "t", height: { max: 20 } }, h);
	assert.equal(full.render(50).length, 20);
	assert.equal(full.bodySize().height, 17);
});

test("keys: actions match first, everything else reaches the body; focus ring cycles and Enter activates", () => {
	const chosen: string[] = [];
	const body = new Recorder();
	const { host: h } = host();
	const popup = new Popup(
		body,
		{
			actions: [
				{ value: "yes", key: "y", label: "Yes" },
				{ value: "no", key: "n", label: "No" },
				{ value: "esc", key: "tui.select.cancel", label: "cancel", hidden: true },
			],
			focusActions: true,
			initialFocus: "no",
			onAction: (value) => chosen.push(value),
		},
		h,
	);
	popup.render(60);
	popup.handleInput("x");
	popup.handleInput("\r");
	popup.handleInput("\t");
	popup.handleInput("\r");
	popup.handleInput("\x1b[D");
	popup.handleInput("\x1b[D");
	popup.handleInput("\r");
	popup.handleInput("y");
	popup.handleInput("\x1b");
	assert.deepEqual(body.keys, ["x"]);
	assert.deepEqual(chosen, ["no", "yes", "yes", "yes", "esc"]);
	// Without a focus ring, Tab and Enter belong to the body (for example a picker's marking).
	const plainBody = new Recorder();
	const second = new Popup(plainBody, { actions: [{ value: "c", key: "c", label: "copy" }] }, h);
	second.handleInput("\t");
	second.handleInput("\r");
	assert.deepEqual(plainBody.keys, ["\t", "\r"]);
});

test("mouse: body events are translated and captured; footer chips are clickable; frame clicks fall through", () => {
	const chosen: string[] = [];
	const body = new Recorder();
	const { host: h } = host(20);
	const popup = new Popup(
		body,
		{
			title: "t",
			actions: [
				{ value: "a", key: "a", label: "approve", primary: true },
				{ value: "c", key: "c", label: "copy", align: "right" },
			],
			onAction: (value) => chosen.push(value),
		},
		h,
	);
	const lines = plain(popup.render(60));
	const layout = popup.layout!;
	assert.deepEqual(popup.handleMouse(mouse("press", layout.bodyLeft + 2, layout.bodyTop + 1)), { capture: true });
	popup.handleMouse(mouse("drag", 999, 999));
	popup.handleMouse(mouse("release", -4, -4));
	assert.deepEqual(
		body.events.map((event) => [event.type, event.x, event.y, event.width, event.height]),
		[
			["press", 2, 1, layout.bodyWidth, layout.bodyHeight],
			["drag", 999 - layout.bodyLeft, 999 - layout.bodyTop, layout.bodyWidth, layout.bodyHeight],
			["release", -4 - layout.bodyLeft, -4 - layout.bodyTop, layout.bodyWidth, layout.bodyHeight],
		],
	);
	assert.equal(popup.handleMouse(mouse("click", 0, 0)), undefined);
	const footer = lines[layout.footerRow]!;
	popup.handleMouse(mouse("click", footer.indexOf("approve"), layout.footerRow));
	popup.handleMouse(mouse("click", footer.indexOf("copy"), layout.footerRow));
	popup.handleMouse(mouse("click", 1, layout.footerRow));
	assert.deepEqual(chosen, ["a", "c"]);
	popup.handleMouse(mouse("wheel", 0, 0, { wheelDelta: 3 }));
	assert.equal(body.events.at(-1)?.type, "wheel");
});

test("focus is forwarded to the body; dispose runs once; status and dynamic options re-render", () => {
	let disposed = 0;
	const body = new Recorder();
	const { host: h, state } = host();
	const popup = new Popup(body, { title: "one", actions: [{ value: "c", label: "copy", align: "right" }] }, h, () => {
		disposed++;
	});
	popup.focused = true;
	assert.equal(body.focused, true);
	popup.setStatus("Copied");
	assert.match(plain(popup.render(60)).join("\n"), /Copied/);
	popup.set("title", "two");
	assert.match(plain(popup.render(60))[0]!, /two/);
	popup.setTimer("3s");
	popup.setTimer("3s");
	assert.equal(state.renders, 3);
	popup.dispose();
	popup.dispose();
	assert.equal(disposed, 1);
	assert.equal(body.disposed, 1);
	popup.handleInput("x");
	assert.deepEqual(body.keys, []);
});

test("theme changes invalidate cached chrome", () => {
	const { host: h, state } = host(20);
	const popup = new Popup(new Recorder(), { title: "t", tone: "warning", actions: [{ value: "a", label: "a" }] }, h);
	const before = popup.render(60);
	state.theme = light;
	const after = popup.render(60);
	assert.notDeepEqual(after, before);
	assert.deepEqual(plain(after), plain(before));
});

// Document popups (the generic part of plan-mode's review card).

const document = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} · 世界 é 🧊\n`).join("\n");

function documentSetup(content = document, rows = 40) {
	let theme = dark;
	let renders = 0;
	const copied: string[] = [];
	const actions: string[] = [];
	let popup!: Popup<string>;
	const built = documentPopup(
		{
			title: "Plan 世界",
			subtitle: "path\nnot another row",
			content,
			actions: [
				{ key: "a", label: "approve", value: "approve", primary: true },
				{ key: "shift+s", label: "all changes", value: "allSummary" },
			],
		},
		{
			theme: () => theme,
			requestRender: () => {
				renders++;
			},
			keybindings,
			copy: async (text) => {
				copied.push(text);
			},
			setStatus: (text, tone) => popup.setStatus(text, tone),
		},
		(action) => {
			actions.push(action);
			popup.dispose();
		},
	);
	popup = new Popup(built.view, built.options, {
		rows: () => rows,
		theme: () => theme,
		requestRender: () => {
			renders++;
		},
		keybindings,
	});
	return {
		popup,
		view: built.view,
		copied,
		actions,
		get renders() {
			return renders;
		},
		theme(next: typeof dark) {
			theme = next;
			setThemeInstance(next);
			popup.invalidate();
		},
	};
}

test("documents obey width and height for markdown and diff, including tiny terminals", () => {
	for (const rows of [1, 2, 3, 5, 8, 12, 24, 40]) {
		for (const width of [0, 1, 2, 3, 10, 40, 80, 160]) {
			for (const format of ["markdown", "diff"] as const) {
				const s = documentSetup(format === "diff" ? "+世界\n-🧊\n".repeat(20) : document, rows);
				const lines = s.popup.render(width);
				assert.ok(lines.length <= Math.max(1, Math.floor(rows * 0.9)));
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
				s.popup.dispose();
			}
		}
	}
});

test("document keyboard and wheel scrolling use bounded scroll state and update the border position", () => {
	const { popup } = documentSetup();
	const first = popup.render(80).join("\n");
	assert.match(stripTerminalSequences(first.split("\n")[0]!), /top ─╮/u);
	popup.handleInput("\x1b[6~");
	assert.notEqual(popup.render(80).join("\n"), first);
	popup.handleInput("g");
	assert.equal(popup.render(80).join("\n"), first);
	const layout = popup.layout!;
	assert.deepEqual(popup.handleMouse(mouse("wheel", 5, layout.bodyTop + 2, { wheelDelta: 9 })), {
		handled: true,
		render: true,
	});
	assert.match(stripTerminalSequences(popup.render(80)[0]!), /\d+% ─╮/u);
	popup.handleInput("G");
	const end = plain(popup.render(80));
	assert.match(end.join("\n"), /Paragraph 119/);
	assert.match(end[0]!, /end ─╮/u);
	popup.dispose();
});

test("document drag selection is body-local, clipped, and copies plain text once", async () => {
	const { popup, copied } = documentSetup("one two three");
	popup.render(80);
	const { bodyLeft, bodyTop } = popup.layout!;
	assert.equal(popup.handleMouse(mouse("press", bodyLeft, bodyTop))?.capture, true);
	popup.handleMouse(mouse("drag", bodyLeft + 3, bodyTop));
	popup.handleMouse(mouse("release", bodyLeft + 3, bodyTop));
	await Promise.resolve();
	assert.deepEqual(copied, ["one"]);
	popup.handleMouse(mouse("release", bodyLeft + 3, bodyTop));
	assert.deepEqual(copied, ["one"]);
	popup.handleMouse(mouse("press", bodyLeft, bodyTop));
	popup.handleMouse(mouse("release", 999, 999));
	await Promise.resolve();
	assert.equal(copied.at(-1), "one two three");
	popup.dispose();
});

test("document copy results cannot redraw a disposed popup; actions use parsed keys including Shift+S", async () => {
	const s = documentSetup("copy me");
	s.popup.render(80);
	s.popup.handleInput("c");
	s.popup.handleInput("S");
	s.popup.handleInput("a");
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(s.actions, ["allSummary"]);
	assert.deepEqual(s.copied, ["copy me"]);
	assert.doesNotMatch(plain(s.popup.render(80)).join("\n"), /Copied/);
});

test("document footer: primary chip, copy/close on the right, clickable; Esc and Ctrl+C cancel", async () => {
	const s = documentSetup("# Heading\n\nBody text");
	const lines = plain(s.popup.render(80));
	const row = s.popup.layout!.footerRow;
	const footer = lines[row]!;
	assert.match(footer, /^│ {2} a approve {4}⇧S all changes +c copy {3}esc close {2}│▌$/u);
	s.popup.handleMouse(mouse("click", footer.indexOf("copy"), row));
	await Promise.resolve();
	await Promise.resolve();
	assert.match(plain(s.popup.render(80))[row]!, /Copied full document/);
	s.popup.handleMouse(mouse("click", footer.indexOf("all changes"), row));
	assert.deepEqual(s.actions, ["allSummary"]);
	for (const key of ["\x1b", "\x03"]) {
		const t = documentSetup();
		t.popup.render(80);
		t.popup.handleInput(key);
		assert.deepEqual(t.actions, ["cancel"]);
	}
});

test("document theme invalidation rebuilds markdown colours", () => {
	const s = documentSetup("# Heading\n\n**bold** and `code`");
	const before = s.popup.render(80);
	s.theme(light);
	const after = s.popup.render(80);
	assert.notDeepEqual(after, before);
	assert.deepEqual(plain(after), plain(before));
	s.theme(dark);
	s.popup.dispose();
});

class MemoryTerminal implements Terminal {
	columns = 100;
	rows = 32;
	kittyProtocolActive = false;
	writes: string[] = [];
	input: (data: string) => void = () => {};
	resize: () => void = () => {};
	start(input: (data: string) => void, resize: () => void) {
		this.input = input;
		this.resize = resize;
	}
	stop() {}
	async drainInput() {}
	write(data: string) {
		this.writes.push(data);
	}
	moveBy() {}
	hideCursor() {}
	showCursor() {}
	clearLine() {}
	clearFromCursor() {}
	clearScreen() {}
	setTitle() {}
	setProgress() {}
	setProgramStatus() {}
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("real pi renderers: fullscreen dispatch reaches the body through the frame; regular mode stays keyboard usable", async () => {
	for (const Renderer of [TuiAltScreen, TuiMainScreen]) {
		const terminal = new MemoryTerminal();
		const tui = new Renderer(terminal);
		const s = documentSetup();
		const popup = new Popup(
			s.view,
			{ title: "Review", height: { max: 0.9 } },
			{
				rows: () => terminal.rows,
				theme: () => dark,
				requestRender: () => tui.requestRender(),
				keybindings,
			},
		);
		tui.start();
		const overlay = tui.showOverlay(popup as Component, { width: "90%", maxHeight: "100%", anchor: "center" });
		try {
			tui.requestRender(true);
			await tick();
			const bounds = overlay.getBounds();
			assert.ok(bounds);
			const before = popup.render(bounds.width).join("\n");
			if (Renderer === TuiAltScreen) terminal.input(`\x1b[<65;${bounds.col + 5};${bounds.row + 5}M`);
			else terminal.input("\x1b[6~");
			await tick();
			assert.notEqual(popup.render(bounds.width).join("\n"), before);
			const offset = terminal.writes.length;
			popup.dispose();
			overlay.hide();
			await tick();
			assert.ok(
				!terminal.writes.slice(offset).join("").includes("\x1b[?1006l"),
				"must not disable mouse tracking",
			);
		} finally {
			popup.dispose();
			overlay.hide();
			tui.stop();
		}
	}
});
