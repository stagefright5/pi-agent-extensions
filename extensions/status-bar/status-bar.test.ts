import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth, type TuiMouseEvent } from "@earendil-works/pi-tui";
import statusBar from "./index.ts";
import { registerStatusAction, statusLineChannel } from "./status-line.ts";

type Footer = {
	render(width: number): string[];
	handleMouse(event: TuiMouseEvent): unknown;
	invalidate(): void;
	dispose?(): void;
};
type InputHandler = (data: string) => { consume?: boolean } | undefined;

const KEY = { left: "\x1b[D", right: "\x1b[C", enter: "\r", esc: "\x1b", altS: "\x1bs", tab: "\t" };

function fixture(fast?: string, theme: any = { fg: (_token: string, text: string) => text }) {
	let start: (_event: unknown, ctx: unknown) => void;
	let shutdown: (_event: unknown, ctx: unknown) => void;
	let footer: Footer;
	let shortcut: ((ctx: unknown) => void) | undefined;
	let input: InputHandler | undefined;
	const notices: string[] = [];
	let renders = 0;
	const statuses = new Map([["plan", "plan review"]]);
	if (fast) statuses.set("fast", fast);
	statusBar({
		on(name: string, handler: typeof start) {
			if (name === "session_start") start = handler;
			if (name === "session_shutdown") shutdown = handler;
		},
		registerShortcut(_key: string, options: { handler: (ctx: unknown) => void }) {
			shortcut = options.handler;
		},
		getThinkingLevel: () => "high",
	} as never);
	const ctx = {
		mode: "tui",
		model: { provider: "openai", name: "GPT-6 Astra", reasoning: true },
		thinkingLevel: "high",
		getContextUsage: () => ({ percent: 71.5, contextWindow: 272000 }),
		sessionManager: {
			getCwd: () => "/project",
			getSessionId: () => "test",
			getLeafId: () => "leaf",
			getEntries: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 16.991 } } } }],
		},
		ui: {
			theme,
			notify: (message: string) => notices.push(message),
			onTerminalInput(handler: InputHandler) {
				input = handler;
				return () => {
					if (input === handler) input = undefined;
				};
			},
			setFooter(factory: Function | undefined) {
				if (!factory) return;
				footer = factory({ requestRender: () => renders++ }, theme, {
					onBranchChange: () => () => {},
					getGitBranch: () => "main",
					getExtensionStatuses: () => statuses,
				});
			},
		},
	};
	start!(undefined, ctx);
	return {
		render: (width = 160) => footer!.render(width)[0]!,
		rows: (width = 160) => footer!.render(width),
		dispose: () => footer!.dispose?.(),
		footer: () => footer!,
		statuses,
		notices,
		renders: () => renders,
		altS: () => shortcut!(ctx),
		/** Raw terminal input as pi delivers it: the navigation listener first, if installed. */
		key: (data: string) => input?.(data),
		listening: () => input !== undefined,
		shutdown: () => shutdown!(undefined, ctx),
	};
}

const click = (x: number, type: TuiMouseEvent["type"] = "click"): TuiMouseEvent => ({
	type,
	button: "left",
	x,
	y: 0,
	screenX: x,
	screenY: 40,
	width: 160,
	height: 1,
	shift: false,
	alt: false,
	ctrl: false,
});

test("fast icon follows effort exactly once, before context and cost", () => {
	// Accept the old status text as well as the new glyph; the stable key carries state.
	for (const value of ["fast", "⚡︎"]) {
		const { render } = fixture(value);
		const line = render();
		assert.ok(line.endsWith("openai/GPT-6 Astra · high · ⚡︎ · 71.5%/272k · $16.991"));
		assert.equal(line.split("⚡︎").length - 1, 1);
		assert.match(line, /plan review/);
		assert.doesNotMatch(line, /\bfast\b/);
	}
});

test("fast icon disappears immediately when the status is cleared", () => {
	const { render, statuses } = fixture("⚡︎");
	statuses.delete("fast");
	assert.ok(render().endsWith("openai/GPT-6 Astra · high · 71.5%/272k · $16.991"));
	assert.doesNotMatch(render(), /⚡/);
});

test("fast marker stays attached to effort at compact widths without overflow", () => {
	const { render } = fixture("⚡︎");
	for (const width of [1, 2, 40, 60, 80, 120, 160]) {
		const line = render(width);
		assert.ok(visibleWidth(line) <= width);
		if (line.includes("⚡︎")) assert.match(line, /high · ⚡︎/);
	}
});

test("lends its line to a focused host editor and steps aside; falls back the moment it stops", () => {
	const { rows, dispose } = fixture();
	const channel = statusLineChannel();
	let hosting = true;
	channel.host = { hostsStatusLine: () => hosting };
	try {
		assert.deepEqual(rows(), [], "the editor draws the line; the footer row disappears");
		const extras = ["shell", "⌃Z undo  ⌃Y redo"];
		const lent = channel.render!(120, extras);
		assert.equal(visibleWidth(lent), 120);
		assert.match(lent, /^\/project · main {2}shell {2}⌃Z undo {2}⌃Y redo · plan review +openai\/GPT-6 Astra/u);
		const narrower = channel.render!(92, extras);
		assert.match(narrower, /^\/project · main {2}shell · plan review +openai/u, "the last extra is dropped first");
		assert.match(channel.render!(40, extras), /shell/u, "the mode outlives the directory when narrow");
		hosting = false;
		assert.equal(rows().length, 1, "picker or overlay focused: the status bar shows again");
		dispose();
		assert.equal(channel.render, undefined, "disposing the footer withdraws the line");
	} finally {
		channel.host = undefined;
	}
});

test("unchanged input reuses the laid-out line; any input change rebuilds it", () => {
	let styled = 0;
	const theme = { fg: (_token: string, text: string) => (styled++, text) };
	const { render, statuses, footer } = fixture(undefined, theme);
	const first = render();
	const afterFirst = styled;
	assert.ok(afterFirst > 0);
	for (let frame = 0; frame < 50; frame++) assert.equal(render(), first);
	assert.equal(styled, afterFirst, "cache hits do no styling or layout work");
	statuses.set("bg-bash", "● 1 running");
	assert.match(render(), /● 1 running/u);
	assert.ok(styled > afterFirst, "a status change rebuilds the line");
	const rebuilt = styled;
	render(120);
	assert.ok(styled > rebuilt, "a width change rebuilds the line");
	const resized = styled;
	footer().invalidate();
	render(120);
	assert.ok(styled > resized, "invalidate (theme change) drops the cache");
});

test("clicking a clickable status runs its action; other columns and hosted lines fall through", () => {
	const { render, statuses, footer } = fixture();
	statuses.set("bg-bash", "● 2 running");
	let opened = 0;
	const unregister = registerStatusAction("bg-bash", { label: "jobs", activate: () => opened++ });
	try {
		const line = plain(render());
		const start = line.indexOf("● 2 running");
		assert.ok(start > 0);
		assert.deepEqual(footer().handleMouse(click(start)), { handled: true });
		assert.deepEqual(footer().handleMouse(click(start + "● 2 running".length - 1)), { handled: true });
		assert.equal(opened, 2);
		assert.equal(footer().handleMouse(click(start + "● 2 running".length)), undefined, "separator");
		assert.equal(footer().handleMouse(click(line.indexOf("plan review"))), undefined, "no action registered");
		assert.equal(footer().handleMouse(click(start, "move")), undefined, "moves never re-render");
		const channel = statusLineChannel();
		channel.host = { hostsStatusLine: () => true };
		assert.equal(footer().handleMouse(click(start)), undefined, "the composer owns clicks while hosting");
		channel.host = undefined;
		assert.equal(opened, 2);
	} finally {
		unregister();
	}
});

test("regions track narrow layouts, wide characters, and clipped statuses", () => {
	const { render, statuses } = fixture();
	statuses.set("bg-bash", "● 世界 running");
	const unregister = registerStatusAction("bg-bash", { label: "jobs", activate() {} });
	try {
		for (const width of [160, 120, 80, 60, 40, 30, 20]) {
			const line = plain(render(width));
			const region = statusLineChannel().regions?.find((candidate) => candidate.id === "bg-bash");
			if (!region) continue;
			assert.ok(region.end <= visibleWidth(line), `region inside the line @${width}`);
			// The region starts exactly where the status text starts (in columns, not code units).
			const prefix = line.slice(0, line.indexOf("●"));
			assert.equal(region.start, visibleWidth(prefix), `start column @${width}`);
		}
	} finally {
		unregister();
	}
});

test("Alt+S focuses clickable statuses: arrows move, Enter opens, Esc and other keys leave", () => {
	const theme = {
		fg: (_t: string, text: string) => text,
		bg: (_t: string, text: string) => text,
		underline: (text: string) => text,
	};
	const { render, statuses, altS, key, listening, notices, renders } = fixture(undefined, theme);
	altS();
	assert.deepEqual(notices, ["No clickable footer statuses"]);
	assert.equal(listening(), false, "nothing clickable: navigation does not start");

	statuses.set("bg-bash", "● 1 running");
	statuses.set("zz", "other");
	const log: string[] = [];
	const offA = registerStatusAction("bg-bash", { label: "jobs", activate: () => log.push("jobs") });
	const offB = registerStatusAction("zz", { label: "zed", activate: () => log.push("zz") });
	try {
		render();
		const before = renders();
		altS();
		assert.ok(listening());
		assert.ok(renders() > before, "focus change requests a render");
		assert.match(plain(render()), /● 1 running ⏎ jobs/u);
		assert.deepEqual(key(KEY.right), { consume: true });
		assert.match(plain(render()), /other ⏎ zed/u);
		assert.doesNotMatch(plain(render()), /⏎ jobs/u);
		key(KEY.right);
		assert.match(plain(render()), /⏎ jobs/u, "wraps around");
		assert.deepEqual(key(KEY.enter), { consume: true });
		assert.deepEqual(log, ["jobs"]);
		assert.equal(listening(), false, "Enter leaves navigation and removes the listener");
		assert.doesNotMatch(plain(render()), /⏎/u);

		altS();
		assert.deepEqual(key(KEY.esc), { consume: true });
		assert.equal(listening(), false);
		altS();
		assert.equal(key("x"), undefined, "other keys pass through unconsumed");
		assert.equal(listening(), false);
		altS();
		altS();
		assert.equal(listening(), false, "Alt+S again toggles navigation off");
		altS();
		offA();
		offB();
		assert.equal(statusLineChannel().focusedStatus, undefined, "unregistering clears focus");
	} finally {
		offA();
		offB();
	}
});

test("shutdown leaves navigation and withdraws regions", () => {
	const theme = {
		fg: (_t: string, text: string) => text,
		bg: (_t: string, text: string) => text,
		underline: (text: string) => text,
	};
	const { render, statuses, altS, listening, shutdown, dispose } = fixture(undefined, theme);
	statuses.set("bg-bash", "● 1 running");
	const off = registerStatusAction("bg-bash", { label: "jobs", activate() {} });
	try {
		render();
		altS();
		shutdown();
		dispose();
		assert.equal(listening(), false);
		assert.equal(statusLineChannel().focusedStatus, undefined);
		assert.equal(statusLineChannel().regions, undefined);
	} finally {
		off();
	}
});

test("both copies of the shared status-line contract stay identical", () => {
	const normalize = (path: string) =>
		readFileSync(new URL(path, import.meta.url), "utf8").replace(/\(([^)]*) keeps an identical copy\)/u, "(…)");
	assert.equal(normalize("./status-line.ts"), normalize("../prompt-truly-mine/status-line.ts"));
});

test("render budget at 200 columns: cache hit p95 < 0.05 ms, miss p95 < 0.3 ms (real theme)", async () => {
	const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const { render, statuses } = fixture("⚡︎", getThemeByName("dark"));
	statuses.set("bg-bash", "● 2 running · ○1 ○1");
	const p95 = (samples: number[]) => samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]!;
	const hits: number[] = [];
	const misses: number[] = [];
	for (let frame = 0; frame < 600; frame++) {
		let started = performance.now();
		render(200);
		if (frame > 100) hits.push(performance.now() - started);
		statuses.set("bg-bash", `● ${frame} running`);
		started = performance.now();
		render(200);
		if (frame > 100) misses.push(performance.now() - started);
	}
	assert.ok(p95(hits) < 0.05, `hit p95 ${p95(hits).toFixed(4)} ms`);
	assert.ok(p95(misses) < 0.3, `miss p95 ${p95(misses).toFixed(4)} ms`);
});
