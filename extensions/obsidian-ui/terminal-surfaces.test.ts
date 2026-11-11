import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { colorToRgb, type TerminalColors } from "@earendil-works/pi-tui";
import { registerTerminalSurfaces, terminalSurfaceTheme, watchTerminalSurfaces } from "./terminal-surfaces.ts";

const dark = { background: { r: 12, g: 16, b: 20 }, foreground: { r: 230, g: 235, b: 240 } };
const light = { background: { r: 245, g: 242, b: 235 }, foreground: { r: 30, g: 30, b: 30 } };

for (const mode of ["truecolor", "256color"] as const) {
	for (const [name, report] of [
		["dark", dark],
		["light", light],
	] as const) {
		test(`${mode}/${name}: shades follow the terminal background, not status hues`, () => {
			const theme = terminalSurfaceTheme(report, mode);
			const flat = terminalSurfaceTheme({}, mode);
			assert.equal(theme.appearance, name);
			assert.notEqual(theme.getBgAnsi("userMessageBg"), flat.getBgAnsi("userMessageBg"));
			assert.notEqual(theme.getBgAnsi("toolPendingBg"), theme.getBgAnsi("userMessageBg"));
			assert.equal(theme.getBgAnsi("toolSuccessBg"), theme.getBgAnsi("toolPendingBg"));
			assert.equal(theme.getBgAnsi("toolErrorBg"), theme.getBgAnsi("toolPendingBg"));
			assert.notEqual(theme.getBgAnsi("selectedBg"), theme.getBgAnsi("userMessageBg"));
			const panel = colorToRgb(theme.colors.toolPendingBg);
			const message = colorToRgb(theme.colors.userMessageBg);
			for (const channel of ["r", "g", "b"] as const) {
				if (name === "dark") {
					assert.ok(panel[channel] > report.background[channel]);
					assert.ok(message[channel] > panel[channel]);
				} else {
					assert.ok(panel[channel] < report.background[channel]);
					assert.ok(message[channel] < panel[channel]);
				}
			}
			for (const token of ["text", "userMessageText", "success", "error", "warning", "syntaxKeyword"] as const) {
				assert.equal(theme.getFgAnsi(token), flat.getFgAnsi(token), `${token} must remain terminal-owned`);
			}
		});
	}
}

test("real user and tool shells use derived shades, retaining colored success/error markers", async (t) => {
	const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { getThemeByName, setThemeInstance } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const { UserMessageComponent, ToolExecutionComponent } = await import("@earendil-works/pi-coding-agent");
	const { compactRenderers } = await import("./tool-renderers.ts");
	t.after(() => setThemeInstance(getThemeByName("system")!));
	for (const colors of [dark, light]) {
		const theme = terminalSurfaceTheme(colors, "truecolor");
		setThemeInstance(theme);
		const user = new UserMessageComponent("User message");
		assert.ok(user.render(80).join("\n").includes(theme.getBgAnsi("userMessageBg")));
		for (const isError of [false, true]) {
			const tool = new ToolExecutionComponent(
				"example",
				"test",
				{},
				{},
				compactRenderers("example"),
				{ requestRender() {} } as never,
				"/tmp",
			);
			tool.markExecutionStarted();
			assert.ok(tool.render(80).join("\n").includes(theme.getBgAnsi("toolPendingBg")));
			tool.updateResult({ content: [{ type: "text", text: "Result" }], isError });
			for (const expanded of [false, true]) {
				tool.setExpanded(expanded);
				const output = tool.render(80).join("\n");
				assert.ok(output.includes(theme.getBgAnsi(isError ? "toolErrorBg" : "toolSuccessBg")));
				if (!expanded) assert.ok(output.includes(theme.fg(isError ? "error" : "success", isError ? "✕" : "✓")));
			}
		}
	}
});

test("without a reported background, keep the terminal-default fallback rather than invent a palette", () => {
	for (const colors of [{}, { foreground: dark.foreground }]) {
		const theme = terminalSurfaceTheme(colors, "truecolor");
		for (const token of ["userMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const) {
			assert.equal(theme.getBgAnsi(token), "\x1b[49m");
		}
	}
});

function fixture() {
	let theme = terminalSurfaceTheme({}, "truecolor");
	let listener: (() => void) | undefined;
	let late: ((colors: TerminalColors) => void) | undefined;
	let report: TerminalColors = dark;
	let reject = false;
	let wait = Promise.resolve();
	let queries = 0;
	let writes = 0;
	const notifications: boolean[] = [];
	const ui = {
		get theme() {
			return theme;
		},
		setTheme(next: typeof theme | string) {
			assert.notEqual(typeof next, "string", "must not persist generated colors or change saved selection");
			theme = next as typeof theme;
			writes++;
			return { success: true };
		},
	};
	const tui = {
		async queryTerminalColors(options: { timeoutMs: number; onLateReply?: (colors: TerminalColors) => void }) {
			assert.equal(options.timeoutMs, 100);
			queries++;
			late = options.onLateReply;
			if (reject) throw new Error("unsupported");
			const response = report;
			await wait;
			return response;
		},
		onTerminalColorSchemeChange(callback: () => void) {
			listener = callback;
			return () => {
				listener = undefined;
			};
		},
		setTerminalColorSchemeNotifications(enabled: boolean) {
			notifications.push(enabled);
		},
	};
	const watcher = watchTerminalSurfaces(ui, tui);
	return {
		ui,
		watcher,
		notifications,
		get queries() {
			return queries;
		},
		get writes() {
			return writes;
		},
		get listening() {
			return Boolean(listener);
		},
		setReport(value: TerminalColors) {
			report = value;
		},
		rejectQueries() {
			reject = true;
		},
		pauseQueries() {
			let resume!: () => void;
			wait = new Promise<void>((resolve) => {
				resume = resolve;
			});
			return resume;
		},
		change() {
			listener?.();
		},
		late(value: TerminalColors) {
			late?.(value);
		},
		select(next: typeof theme) {
			theme = next;
			watcher.render();
		},
	};
}

test("zero-row observer refreshes on terminal appearance changes, not on each frame", async () => {
	const f = fixture();
	try {
		assert.deepEqual(f.watcher.render(), []);
		assert.equal(f.writes, 0, "no theme mutation from inside render");
		await setImmediate();
		assert.equal(f.queries, 1);
		const before = f.ui.theme.getBgAnsi("userMessageBg");
		for (let i = 0; i < 100; i++) f.watcher.render();
		await setImmediate();
		assert.equal(f.queries, 1);
		f.setReport(light);
		f.change();
		await setImmediate();
		assert.equal(f.queries, 2);
		assert.notEqual(f.ui.theme.getBgAnsi("userMessageBg"), before);
		assert.equal(f.ui.theme.appearance, "light");
		assert.equal(f.notifications.at(-1), true);
		const writes = f.writes;
		f.change();
		await setImmediate();
		assert.equal(f.writes, writes, "unchanged colors do not invalidate the whole transcript");
	} finally {
		f.watcher.dispose();
	}
});

test("late reports apply after a timeout and transient failures retain the last known background", async () => {
	const f = fixture();
	try {
		f.setReport({});
		f.watcher.render();
		await setImmediate();
		assert.equal(f.ui.theme.getBgAnsi("userMessageBg"), "\x1b[49m");
		f.late(dark);
		const shaded = f.ui.theme.getBgAnsi("userMessageBg");
		assert.notEqual(shaded, "\x1b[49m");
		f.rejectQueries();
		f.change();
		await setImmediate();
		assert.equal(f.ui.theme.getBgAnsi("userMessageBg"), shaded);
	} finally {
		f.watcher.dispose();
	}
});

test("other themes are respected; switching back and disposing/reloading are safe", async () => {
	const f = fixture();
	f.watcher.render();
	await setImmediate();
	const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const other = getThemeByName("light")!;
	f.select(other);
	f.late(dark);
	f.change();
	await setImmediate();
	assert.equal(f.ui.theme, other);
	assert.equal(f.queries, 1);
	f.select(terminalSurfaceTheme({}, "truecolor"));
	await setImmediate();
	assert.equal(f.queries, 2);
	assert.notEqual(f.ui.theme.getBgAnsi("userMessageBg"), "\x1b[49m");
	f.watcher.dispose();
	const writes = f.writes;
	f.late(light);
	f.watcher.render();
	f.watcher.dispose();
	await setImmediate();
	assert.equal(f.writes, writes);
	assert.equal(f.listening, false);
	assert.equal(f.notifications.at(-1), false);
});

test("shutdown during an in-flight query disables notifications and ignores its result", async () => {
	const f = fixture();
	const resume = f.pauseQueries();
	f.watcher.render();
	await setImmediate();
	assert.equal(f.queries, 1);
	assert.equal(f.notifications.at(-1), true);
	f.watcher.dispose();
	assert.equal(f.notifications.at(-1), false);
	resume();
	await setImmediate();
	assert.equal(f.writes, 0);
	assert.equal(f.listening, false);
});

test("shutdown while a refresh is queued does not apply colors or leave a listener", async () => {
	const f = fixture();
	f.watcher.render();
	f.watcher.dispose();
	await setImmediate();
	assert.equal(f.queries, 0);
	assert.equal(f.writes, 0);
	assert.equal(f.listening, false);
});

test("lifecycle registers only a zero-row widget in TUI mode and removes it on shutdown", () => {
	const handlers = new Map<string, (_event: unknown, ctx: unknown) => void>();
	registerTerminalSurfaces({ on: (name: string, handler: never) => handlers.set(name, handler) } as never);
	const calls: unknown[][] = [];
	const ui = { setWidget: (...args: unknown[]) => calls.push(args) };
	for (const mode of ["rpc", "json", "print"]) {
		handlers.get("session_start")!({}, { mode, ui });
		handlers.get("session_shutdown")!({}, { mode, ui });
	}
	assert.equal(calls.length, 0);
	handlers.get("session_start")!({}, { mode: "tui", ui });
	assert.equal(typeof calls[0]![1], "function");
	assert.deepEqual(calls[0]![2], { placement: "belowEditor" });
	handlers.get("session_shutdown")!({}, { mode: "tui", ui });
	assert.deepEqual(calls[1], ["terminal-native-surfaces", undefined]);
});
