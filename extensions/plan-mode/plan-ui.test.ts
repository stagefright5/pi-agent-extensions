import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, type Theme, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	visibleWidth,
	stripTerminalSequences,
	TuiAltScreen,
	TuiMainScreen,
	type Terminal,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { PlanDocumentView, createPlanMessageComponent, type DocumentHost, type ReviewAction } from "./plan-ui.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { getThemeByName, setThemeInstance } = await import(new URL("modes/interactive/theme/theme.js", host).href);
initTheme("dark", false);
const dark: Theme = getThemeByName("dark");
const light: Theme = getThemeByName("light");
const keybindings: Pick<KeybindingsManager, "matches"> = {
	matches(data, action) {
		const keys = {
			"tui.select.cancel": "escape",
			"tui.select.confirm": "enter",
			"tui.select.up": "up",
			"tui.select.down": "down",
			"tui.select.pageUp": "pageUp",
			"tui.select.pageDown": "pageDown",
		} as const;
		return action in keys && matchesKey(data, keys[action]);
	},
};
const mouse = (type: TuiMouseEvent["type"], x: number, y: number, extra = {}): TuiMouseEvent => ({
	type,
	x,
	y,
	screenX: x,
	screenY: y,
	width: 80,
	height: 36,
	button: "left",
	shift: false,
	alt: false,
	ctrl: false,
	...extra,
});
const document = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} · 世界 é 🧊\n`).join("\n");
function setup(content = document) {
	let rows = 40;
	let theme = dark;
	let renders = 0;
	let disposals = 0;
	const copied: string[] = [];
	const actions: ReviewAction[] = [];
	const host: DocumentHost = {
		rows: () => rows,
		theme: () => theme,
		keybindings,
		requestRender: () => {
			renders++;
		},
		copy: async (text) => {
			copied.push(text);
		},
	};
	const view = new PlanDocumentView(
		{
			title: "Plan 世界",
			subtitle: "path\nnot another row",
			content,
			actions: [
				{ key: "a", label: "approve", value: "approve" },
				{ key: "shift+s", label: "all changes", value: "allSummary" },
			],
		},
		host,
		(action) => actions.push(action),
		() => {
			disposals++;
		},
	);
	return {
		view,
		host,
		copied,
		actions,
		get renders() {
			return renders;
		},
		get disposals() {
			return disposals;
		},
		resize: (height: number) => {
			rows = height;
		},
		theme: (next: Theme) => {
			theme = next;
			setThemeInstance(next);
			view.invalidate();
		},
	};
}

test("all views and inline plans obey width and height, including one-cell terminals", () => {
	const setupView = setup();
	for (const rows of [1, 2, 3, 5, 8, 12, 24, 40]) {
		setupView.resize(rows);
		for (const width of [0, 1, 2, 3, 10, 40, 80, 160]) {
			for (const format of ["markdown", "diff"] as const) {
				const view = new PlanDocumentView(
					{ title: "test", content: format === "diff" ? "+世界\n-🧊\n".repeat(20) : document, format },
					setupView.host,
					() => {},
				);
				const lines = view.render(width);
				assert.ok(lines.length <= Math.max(1, Math.floor(rows * 0.9)));
				for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
				view.dispose();
			}
			const inline = createPlanMessageComponent(document, "世界 title", 1, "/tmp/plan.md", dark);
			for (const line of inline.render(width)) assert.ok(visibleWidth(line) <= width);
		}
	}
	setupView.view.dispose();
});

test("keyboard and normalized wheel use bounded native scroll state", () => {
	const { view } = setup();
	const first = view.render(80).join("\n");
	view.handleInput("\x1b[6~");
	assert.notEqual(view.render(80).join("\n"), first);
	view.handleInput("g");
	assert.equal(view.render(80).join("\n"), first);
	assert.deepEqual(view.handleMouse(mouse("wheel", 5, 5, { wheelDelta: 9 })), { handled: true, render: true });
	assert.notEqual(view.render(80).join("\n"), first);
	view.handleInput("G");
	assert.match(stripTerminalSequences(view.render(80).join("\n")), /Paragraph 119/);
	view.dispose();
});

test("fullscreen drag selection is local, clipped, and copies plain text once", async () => {
	const { view, copied } = setup("one two three");
	view.render(80);
	assert.equal(view.handleMouse(mouse("press", 0, 3))?.capture, true);
	view.handleMouse(mouse("drag", 3, 3));
	view.handleMouse(mouse("release", 3, 3));
	await Promise.resolve();
	assert.deepEqual(copied, ["one"]);
	view.handleMouse(mouse("release", 3, 3));
	assert.deepEqual(copied, ["one"]);
	view.handleMouse(mouse("press", -5, 3));
	view.handleMouse(mouse("release", 999, 999));
	await Promise.resolve();
	assert.equal(copied.at(-1), "one two three");
	view.dispose();
});

test("copy callbacks cannot redraw a disposed interaction; close is idempotent", async () => {
	const s = setup("copy me");
	s.view.render(80);
	s.view.handleInput("c");
	s.view.close();
	s.view.close("approve");
	s.view.dispose();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(s.disposals, 1);
	assert.deepEqual(s.actions, ["cancel"]);
	assert.deepEqual(s.copied, ["copy me"]);
	assert.equal(s.renders, 0);
});

test("theme invalidation rebuilds markdown and diff colors", () => {
	const s = setup("# Heading\n\n**bold** and `code`");
	const before = s.view.render(80);
	s.theme(light);
	const after = s.view.render(80);
	assert.notDeepEqual(after, before);
	assert.deepEqual(after.map(stripTerminalSequences), before.map(stripTerminalSequences));
	s.theme(dark);
	s.view.dispose();
});

test("review actions use parsed keys, including Shift+S, and no input acts after disposal", () => {
	const s = setup();
	s.view.render(80);
	s.view.handleInput("S");
	s.view.handleInput("a");
	assert.deepEqual(s.actions, ["allSummary"]);
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

test("real pi renderers: fullscreen dispatch reaches handleMouse; regular mode stays keyboard usable", async () => {
	for (const Renderer of [TuiAltScreen, TuiMainScreen]) {
		const terminal = new MemoryTerminal();
		const tui = new Renderer(terminal);
		const s = setup();
		const view = new PlanDocumentView(
			{ title: "Review", content: document },
			{
				...s.host,
				rows: () => terminal.rows,
				requestRender: () => tui.requestRender(),
			},
			() => {},
		);
		tui.start();
		const overlay = tui.showOverlay(view, { width: "90%", maxHeight: "90%", anchor: "center" });
		try {
			tui.requestRender(true);
			await tick();
			const bounds = overlay.getBounds();
			assert.ok(bounds);
			const before = view.render(bounds.width).join("\n");
			if (Renderer === TuiAltScreen) terminal.input(`\x1b[<65;${bounds.col + 5};${bounds.row + 5}M`);
			else terminal.input("\x1b[6~");
			await tick();
			assert.notEqual(view.render(bounds.width).join("\n"), before);
			const offset = terminal.writes.length;
			view.dispose();
			overlay.hide();
			await tick();
			assert.ok(
				!terminal.writes.slice(offset).join("").includes("\x1b[?1006l"),
				"view must not disable host mouse tracking",
			);
		} finally {
			view.dispose();
			overlay.hide();
			tui.stop();
		}
	}
});
