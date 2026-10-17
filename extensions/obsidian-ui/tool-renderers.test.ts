import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters as plain } from "node:util";
import {
	createReadToolDefinition,
	createWriteToolDefinition,
	createEditToolDefinition,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth, TuiMainScreen, type Terminal } from "@earendil-works/pi-tui";
import extension from "./index.ts";
import {
	callSubject,
	compactRenderers,
	fitLabel,
	formatDuration,
	resolveRenderers,
	resultNotices,
} from "./tool-renderers.ts";

// Tests intentionally use pi's real schema/loader. Production imports only public APIs.
const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { loadThemeFromPath, setThemeJsonValidator, setThemeInstance, getThemeByName } = await import(
	new URL("modes/interactive/theme/theme.js", host).href
);
const { validateThemeJson } = await import(new URL("modes/interactive/theme/theme-schema.js", host).href);
setThemeJsonValidator(validateThemeJson);
const path = fileURLToPath(new URL("./themes/obsidian-ice.json", import.meta.url));
const theme = loadThemeFromPath(path, "truecolor");
setThemeInstance(theme);
const context = (extra = {}) => ({
	args: {},
	state: {},
	cwd: "/project",
	toolCallId: "test",
	invalidate() {},
	lastComponent: undefined,
	executionStarted: true,
	argsComplete: true,
	isPartial: true,
	expanded: false,
	showImages: true,
	isError: false,
	durationMs: undefined,
	outputPad: 1,
	...extra,
});
const result = (text: string, details?: unknown) => ({ content: [{ type: "text" as const, text }], details });
const render = (component: { render(width: number): string[] }, width = 80) =>
	component.render(width).map(plain).join("\n");

test("theme passes pi's strict loader in truecolor and 256-color modes", () => {
	for (const mode of ["truecolor", "256color"]) {
		const loaded = loadThemeFromPath(path, mode);
		assert.equal(loaded.name, "obsidian-ice");
		assert.equal(loaded.appearance, "dark");
		assert.equal(loaded.getColorMode(), mode);
		assert.equal(visibleWidth(loaded.fg("text", "世界 é 🧊")), 9);
	}
});

test("headers handle partial arguments, sanitize metadata, and only show real durations", () => {
	assert.equal(callSubject("read", null, "/project"), "");
	assert.equal(
		callSubject("read", { path: "/project/src/世界.ts", offset: 3, limit: 10 }, "/project"),
		"src/世界.ts · from 3 · limit 10",
	);
	assert.equal(callSubject("bash", { command: "\u001b[31mecho\nhello" }, "/project"), "echo hello");
	assert.equal(formatDuration(undefined), "");
	assert.equal(formatDuration(Number.NaN), "");
	assert.equal(formatDuration(0), "0ms");
	assert.equal(formatDuration(1250), "1.3s");
});

test("compact read has bounded preview, truthful status, truncation recovery, and full expanded output", () => {
	const native = createReadToolDefinition("/project");
	const renderer = compactRenderers("read", native);
	const ctx = context({ args: { path: "src/file.txt" } });
	const call = renderer.renderCall!(ctx.args, theme, ctx);
	assert.doesNotMatch(render(call), /✓/);
	const data = result(
		Array.from({ length: 45 }, (_, i) => `line ${i}`).join("\n") +
			"\n[Showing lines 1-45. Use offset=46 to continue.]",
		{ truncation: { truncated: true }, fullOutputPath: "/tmp/full.txt" },
	);
	const original = structuredClone(data);
	const body = renderer.renderResult!(data, { expanded: false, isPartial: false }, theme, {
		...ctx,
		isPartial: false,
	});
	assert.match(render(call), /✓/);
	assert.match(render(body), /more rows/);
	assert.match(render(body), /Use offset=46/);
	assert.match(render(body), /\/tmp\/full.txt/);
	const expanded = renderer.renderResult!(data, { expanded: true, isPartial: false }, theme, {
		...ctx,
		expanded: true,
		isPartial: false,
		lastComponent: body,
	});
	assert.match(render(expanded), /line 44/);
	assert.deepEqual(data, original);
});

test("native expanded write preserves code and native errors survive state changes", () => {
	const native = createWriteToolDefinition("/project");
	const renderer = compactRenderers("write", native);
	const ctx = context({ args: { path: "out.txt", content: "first\nlast" } });
	const call = renderer.renderCall!(ctx.args, theme, ctx);
	assert.doesNotMatch(render(call), /first/);
	const expanded = renderer.renderCall!(ctx.args, theme, { ...ctx, expanded: true, lastComponent: call });
	assert.match(render(expanded), /last/);
	const good = renderer.renderResult!(result("Written"), { expanded: false, isPartial: false }, theme, ctx);
	const bad = renderer.renderResult!(result("Permission denied"), { expanded: false, isPartial: false }, theme, {
		...ctx,
		isError: true,
		lastComponent: good,
	});
	assert.match(render(bad), /Permission denied/);
});

test("custom, partial and self-shell renderers are preserved by identity", () => {
	const native = createReadToolDefinition("/project");
	const natives = new Map([["read", native]]);
	assert.notEqual(resolveRenderers("read", native, natives), native);
	const custom: ToolRenderers = { renderCall: () => new Text("custom", 0, 0) };
	for (const name of ["read", "bash", "codemode", "ask_user_question", "mcp__anything"])
		assert.equal(resolveRenderers(name, custom, natives), custom);
	const edit = createEditToolDefinition("/project");
	assert.equal(resolveRenderers("edit", edit, natives), edit);
});

test("unknown tools, parallel rows, images, errors and narrow widths remain safe", () => {
	const renderer = compactRenderers("mcp__工具");
	const a = context({ args: { url: "https://example.test/" + "世界é🧊".repeat(30) } });
	const b = context();
	const aCall = renderer.renderCall!(a.args, theme, a);
	const bCall = renderer.renderCall!(b.args, theme, b);
	const body = renderer.renderResult!(
		{
			content: [
				{ type: "image", mimeType: "image/png", data: "test" },
				{ type: "text", text: "世界é🧊".repeat(100) },
			],
			details: undefined,
		},
		{ expanded: false, isPartial: false },
		theme,
		{ ...a, isError: true },
	);
	assert.match(render(aCall), /✕/);
	assert.doesNotMatch(render(bCall), /✓|✕/);
	assert.match(render(body), /image/);
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160]) {
		for (const component of [aCall, bCall, body]) {
			for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width, `overflow at ${width}`);
		}
	}
});

test("partial results stay pending, older results omit timing, and generic expansion is complete", () => {
	const renderer = compactRenderers("legacy_tool");
	const ctx = context({ args: { query: "test", extra: "retained argument" } });
	const call = renderer.renderCall!(ctx.args, theme, ctx);
	const data = result("start\nsecond\nthird\nfourth\nlast");
	const partial = renderer.renderResult!(data, { expanded: false, isPartial: true }, theme, ctx);
	assert.match(render(call, 120), /streaming/);
	assert.doesNotMatch(render(call), /✓|\\d+ms/);
	renderer.renderResult!(data, { expanded: false, isPartial: false }, theme, {
		...ctx,
		isPartial: false,
		lastComponent: partial,
	});
	assert.match(render(call), /✓/);
	assert.doesNotMatch(render(call), /\\d+ms/);
	const expanded = renderer.renderResult!(data, { expanded: true, isPartial: false }, theme, {
		...ctx,
		expanded: true,
		lastComponent: partial,
	});
	assert.match(render(expanded), /last/);
	assert.match(
		render(renderer.renderCall!(ctx.args, theme, { ...ctx, expanded: true, lastComponent: call })),
		/retained argument/,
	);
});

test("ordinary source mentioning truncation is not duplicated as a warning", () => {
	assert.deepEqual(resultNotices(result("const truncated = truncateToWidth(text, 10);\n// full output is kept")), []);
	assert.equal(callSubject("read", { path: "file", offset: "1\\nBAD", limit: Number.NaN }, "/project"), "file");
});

test("real read-tool limit notices remain visible while collapsed", async () => {
	const root = await mkdtemp(join(tmpdir(), "obsidian-read-"));
	try {
		await writeFile(join(root, "data.txt"), Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
		const native = createReadToolDefinition(root);
		const renderer = compactRenderers("read", native);
		const data = await native.execute("test", { path: "data.txt", limit: 8 });
		const body = renderer.renderResult!(data, { expanded: false, isPartial: false }, theme, context());
		assert.match(render(body), /22 more lines in file\. Use offset=9 to continue\./);
		await writeFile(join(root, "huge.txt"), "x".repeat(60_000));
		const huge = await native.execute("test", { path: "huge.txt" });
		assert.ok(resultNotices(huge).some((notice) => /Use bash:/.test(notice)));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("expanded native calls, results and errors fit zero- and one-column widths", () => {
	for (const native of [createReadToolDefinition("/project"), createWriteToolDefinition("/project")]) {
		for (const isError of [false, true]) {
			const renderer = compactRenderers(native.name, native);
			const ctx = context({
				args: { path: "世界.ts", content: "世界🧊".repeat(20) },
				expanded: true,
				isError,
				isPartial: false,
			});
			const components = [
				renderer.renderCall!(ctx.args, theme, ctx),
				renderer.renderResult!(result("世界🧊".repeat(20)), { expanded: true, isPartial: false }, theme, ctx),
			];
			for (const width of [0, 1, 2, 4, 10, 80])
				for (const component of components) {
					for (const line of component.render(width))
						assert.ok(visibleWidth(line) <= width, `${native.name}/${isError} overflow at ${width}`);
				}
		}
	}
});

test("host tool components refresh colors and native expansion after streaming", async () => {
	const { ToolExecutionComponent } = await import(
		new URL("modes/interactive/components/tool-execution.js", host).href
	);
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
	const tui = new TuiMainScreen(terminal);
	const component = new ToolExecutionComponent(
		"read",
		"host-test",
		{ path: "data.txt" },
		{ showImages: false },
		compactRenderers("read", createReadToolDefinition("/project")),
		tui,
		"/project",
	);
	try {
		component.markExecutionStarted();
		component.updateResult({ ...result("first\nsecond\nthird\nlast"), isError: false }, true);
		assert.match(render(component, 120), /streaming/);
		component.updateResult({ ...result("first\nsecond\nthird\nlast"), isError: false, durationMs: 1250 }, false);
		assert.match(render(component, 120), /✓.*1\.3s/);
		const before = component.render(80).join("\n");
		const light = getThemeByName("light");
		setThemeInstance(light);
		component.invalidate();
		const after = component.render(80).join("\n");
		assert.notEqual(after, before);
		assert.ok(after.includes(light.getBgAnsi("toolSuccessBg")));
		assert.ok(after.includes(light.getFgAnsi("toolOutput")));
		component.setExpanded(true);
		assert.match(render(component), /last/);
		for (const width of [8, 10, 40, 80])
			for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
	} finally {
		setThemeInstance(theme);
	}
});

test("extension registers only a resolver, not tools or transcript mutators", () => {
	const calls: string[] = [];
	extension({
		registerToolRenderer() {
			calls.push("renderer");
		},
	} as never);
	assert.deepEqual(calls, ["renderer"]);
});

test("cut labels keep the tool box background behind the ellipsis", () => {
	const label = "\u001b[1mbash\u001b[22m  \u001b[36m" + "x".repeat(80) + "\u001b[39m";
	const fitted = fitLabel(label, 30);
	assert.equal(visibleWidth(fitted), 30);
	assert.match(plain(fitted), /…$/u);
	// Only the foreground and text attributes are reset, never the background.
	assert.ok(!fitted.includes("\u001b[0m") && !fitted.includes("\u001b[49m"));
});
