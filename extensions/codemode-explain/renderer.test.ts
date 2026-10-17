import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { codeKey, SummaryStore } from "./explain.ts";
import {
	errorLine,
	explainRenderers,
	faint,
	failuresOf,
	failureText,
	headerText,
	phaseOf,
	shortArgs,
	SPINNERS,
	statusText,
	stopAnimations,
} from "./renderer.ts";

// Tests use pi's real codemode renderer and theme. Production imports only public APIs.
const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { initTheme, theme } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const { codemodeRenderers } = (await import(new URL("extensions/codemode/renderer.js", host).href)) as {
	codemodeRenderers: ToolRenderers;
};
initTheme("dark");

const CODE = Array.from({ length: 20 }, (_, i) => `const v${i} = await tools.read({ path: "f${i}" });`).join("\n");
const SUMMARY =
	"Rewrites the editor chrome tests to expect the new mode and hint rows, then writes the file and greps for shell";
const render = (component: { render(width: number): string[] }, width = 60) =>
	component
		.render(width)
		.map((line) => plain(line).trimEnd())
		.join("\n");
const spinnerFrames = Object.values(SPINNERS).flatMap((s) => s.frames);
const withoutSpinner = (text: string) => spinnerFrames.reduce((t, f) => t.replaceAll(f, "#"), text);

function liveRow(store: SummaryStore) {
	const renderers = explainRenderers(codemodeRenderers, store);
	let redraws = 0;
	const ctx = {
		args: { code: CODE },
		state: {},
		cwd: "/project",
		toolCallId: "call",
		invalidate: () => void redraws++,
		lastComponent: undefined as unknown,
		executionStarted: false,
		argsComplete: false,
		isPartial: true,
		expanded: false,
		showImages: true,
		isError: false,
		durationMs: undefined as number | undefined,
		outputPad: 1,
	};
	let callSlot: unknown;
	let resultSlot: unknown;
	return {
		ctx,
		redraws: () => redraws,
		lastCall: () => callSlot as { render(width: number): string[] },
		call(extra: Partial<typeof ctx> = {}) {
			Object.assign(ctx, extra);
			const c = renderers.renderCall!(ctx.args, theme, { ...ctx, lastComponent: callSlot } as never);
			callSlot = c;
			return render(c);
		},
		result(details: unknown, output = "", isPartial = ctx.isPartial) {
			const content = [
				{ type: "text" as const, text: `Script completed\nWall time 1.0 seconds\nOutput:\n${output}` },
			];
			const r = renderers.renderResult!(
				{ content, details } as never,
				{ expanded: ctx.expanded, isPartial },
				theme,
				{ ...ctx, isPartial, lastComponent: resultSlot } as never,
			);
			resultSlot = r;
			return render(r);
		},
	};
}

test("phases follow argument streaming, execution, and the pending summary", () => {
	assert.equal(phaseOf({ isPartial: true, argsComplete: false }), "writing");
	assert.equal(phaseOf({ isPartial: true, argsComplete: true }), "executing");
	assert.equal(phaseOf({ isPartial: false, argsComplete: true }, { status: "pending" }), "summarizing");
	assert.equal(phaseOf({ isPartial: false, argsComplete: true }, { status: "failed" }), "done");
	assert.equal(phaseOf({ isPartial: false, argsComplete: false }), "done");
	// Each loading phase animates differently.
	const sets = Object.values(SPINNERS).map((s) => s.frames.join());
	assert.equal(new Set(sets).size, 3);
});

test("a live row never shows code while collapsed and ends with the full summary and a compact status", async (t) => {
	t.after(stopAnimations);
	const store = new SummaryStore();
	const r = liveRow(store);
	const calls = [
		{ name: "read", args: '{"path":"a"}', status: "ok", durationMs: 1 },
		{ name: "write", args: '{"path":"a"}', status: "ok", durationMs: 1 },
		{ name: "bash", args: '{"command":"grep"}', status: "error", durationMs: 10 },
	];

	assert.match(withoutSpinner(r.call()), /^# Writing codemode tool call…$/);
	r.ctx.argsComplete = true;
	store.set(codeKey(CODE), { status: "pending" });
	assert.match(withoutSpinner(r.call({ executionStarted: true })), /^# Executing code…$/);
	assert.match(
		r.result({ calls: calls.slice(0, 1).map((c) => ({ ...c, status: "running" })) }),
		/1 call · 1 running · Elapsed/,
	);

	// Animations redraw the row on their own.
	const before = r.redraws();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.ok(r.redraws() > before);

	store.set(codeKey(CODE), { status: "done", text: SUMMARY });
	const executing = withoutSpinner(r.call());
	assert.ok(executing.startsWith("# Executing code: Rewrites"));
	assert.match(executing.replace(/\s+/g, " "), /greps for shell$/);

	const done = r.call({ isPartial: false, durationMs: 1000 });
	assert.equal(done.replace(/\s+/g, " "), `✓ Codemode executed: ${SUMMARY}`);
	assert.doesNotMatch(done, /const v0|…$/);
	assert.equal(
		r.result({ calls }, '{"output":"34: for (const row of ..."}', false),
		"\n3 calls · 1 failed · Took 1.0s",
	);

	// The animation stops once the row settles.
	const settled = r.redraws();
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(r.redraws(), settled);
});

test("expanded rows keep the summary above the full code and pi's full result", (t) => {
	t.after(stopAnimations);
	const store = new SummaryStore();
	store.set(codeKey(CODE), { status: "done", text: SUMMARY });
	const r = liveRow(store);
	const call = r.call({
		argsComplete: true,
		executionStarted: true,
		isPartial: false,
		durationMs: 1000,
		expanded: true,
	});
	assert.ok(call.startsWith("✓ Codemode executed: Rewrites"));
	assert.match(call, /const v0 = await tools\.read/);
	assert.match(call, /const v19 = await tools\.read/);
	const calls = [{ name: "bash", args: '{"command":"grep"}', status: "error", durationMs: 10, error: "boom" }];
	const result = r.result({ calls }, "hello", false);
	assert.match(result, /✗ bash/);
	assert.match(result, /boom/);
	assert.match(result, /hello/);
	assert.match(result, /Took 1\.0s/);
});

test("finished rows without a summary and failed scripts stay code-free while collapsed", (t) => {
	t.after(stopAnimations);
	const store = new SummaryStore();
	const r = liveRow(store);
	const done = r.call({ argsComplete: true, executionStarted: true, isPartial: false, isError: true, durationMs: 5 });
	assert.equal(done, "✗ Codemode failed");
	assert.match(r.result(undefined, "Script error: x", false), /^\nscript failed · Took 5ms$/);

	store.set(codeKey(CODE), { status: "pending" });
	r.call({ isError: false });
	r.result(undefined, "", false);
	assert.match(withoutSpinner(render(r.lastCall())), /^✓ Codemode executed: #$/);
});

test("invalid arguments keep pi's native presentation", () => {
	const r = liveRow(new SummaryStore());
	r.ctx.args = { code: 42 } as never;
	assert.match(r.call({ argsComplete: true }), /invalid arg/);
});

test("status text counts nested calls and prefers the recorded duration", () => {
	const ctx = { isPartial: false, isError: false, durationMs: 2500 };
	assert.equal(plain(statusText(theme, undefined, ctx, {})), "Took 2.5s");
	assert.equal(
		plain(statusText(theme, { calls: [{ status: "cancelled" }] }, ctx, {})),
		"1 call · 1 cancelled · Took 2.5s",
	);
	assert.equal(
		plain(statusText(theme, {}, { ...ctx, isPartial: true, durationMs: undefined }, { startedAt: 0 }, 1200)),
		"Elapsed 1.2s",
	);
	assert.equal(plain(statusText(theme, {}, { ...ctx, durationMs: undefined }, {})), "");
});

test("failure lines use the tool's own error, fold in bash exit codes, and pick the identifying argument", () => {
	assert.equal(shortArgs('{"command":"sleep 1; cat /nonexistent-demo-file"}'), "sleep 1; cat /nonexistent-demo-file");
	assert.equal(shortArgs('{"limit":3,"path":"/a.json"}'), "/a.json");
	assert.equal(shortArgs('{"n":1,"text":"hello"}'), "hello");
	assert.equal(shortArgs('{"command":"x'), '{"command":"x');
	assert.ok(shortArgs(JSON.stringify({ command: "y".repeat(100) })).endsWith("…"));
	assert.equal(
		errorLine("cat: /nonexistent-demo-file: No such file or directory\n\n\nCommand exited with code 1"),
		"cat: /nonexistent-demo-file: No such file or directory (exit 1)",
	);
	assert.equal(errorLine("Command exited with code 2"), "exit 2");
	assert.equal(errorLine(undefined), "failed");

	const content = [
		{
			type: "text",
			text: "Script failed\nWall time 0.1 seconds\nOutput:\npartial\nScript error: TypeError: x is not a function",
		},
	];
	assert.deepEqual(
		failuresOf(
			content,
			{ calls: [{ name: "read", args: '{"path":"/m"}', status: "error", error: "ENOENT" }] },
			true,
		),
		[
			{ label: "read /m", error: "ENOENT" },
			{ label: "Script error:", error: "TypeError: x is not a function" },
		],
	);
	assert.deepEqual(failuresOf([{ type: "text", text: "Invalid @options line" }], undefined, true), [
		{ label: "Script error:", error: "Invalid @options line" },
	]);
	assert.deepEqual(failuresOf(content, { calls: [{ status: "ok" }, { status: "cancelled" }] }, false), []);

	const many = Array.from({ length: 5 }, (_, i) => ({ label: `bash c${i}`, error: "boom" }));
	assert.equal(
		plain(failureText(theme, many, false)),
		"✗ bash c0 — boom\n✗ bash c1 — boom\n✗ bash c2 — boom\n+2 more failed",
	);
	assert.equal(plain(failureText(theme, many, true)).split("\n").length, 5);
});

test("failed calls and script errors appear under the header, collapsed and expanded", (t) => {
	t.after(stopAnimations);
	const store = new SummaryStore();
	store.set(codeKey(CODE), { status: "done", text: "Read files and test a missing one" });
	const r = liveRow(store);
	const calls = [
		{ name: "bash", args: '{"command":"sleep 2"}', status: "ok", durationMs: 2000 },
		{
			name: "bash",
			args: '{"command":"sleep 1; cat /nope"}',
			status: "error",
			durationMs: 1000,
			error: "cat: /nope: No such file or directory\n\nCommand exited with code 1",
		},
	];
	const header = { argsComplete: true, executionStarted: true, isPartial: false, durationMs: 3000 };
	const failure = "✗ bash sleep 1; cat /nope — cat: /nope: No such file or directory (exit 1)";
	// pi renders the call, then the result, then draws both.
	let call = r.call(header);
	const result = r.result({ calls }, "{}", false);
	call = render(r.lastCall(), 100);
	assert.equal(
		`${call}\n${result}`,
		`✓ Codemode executed: Read files and test a missing one\n${failure}\n\n2 calls · 1 failed · Took 3.0s`,
	);

	r.call({ expanded: true });
	r.result({ calls }, "{}", false);
	const expanded = render(r.lastCall(), 100);
	assert.ok(expanded.startsWith(`✓ Codemode executed: Read files and test a missing one\n${failure}\n\nconst v0`));

	r.call({ expanded: false, isError: true });
	r.result({ calls: [] }, "partial\nScript error: boom", false);
	assert.equal(
		render(r.lastCall(), 100),
		"✗ Codemode failed: Read files and test a missing one\n✗ Script error: boom",
	);
});

test("the script error is always visible and outside the collapsed limit", () => {
	const failures = [
		...Array.from({ length: 4 }, (_, i) => ({ label: `bash c${i}`, error: "boom" })),
		{ label: "Script error:", error: "Error: thrown" },
	];
	assert.equal(
		plain(failureText(theme, failures, false)),
		"✗ bash c0 — boom\n✗ bash c1 — boom\n✗ bash c2 — boom\n+1 more failed\n✗ Script error: Error: thrown",
	);
	assert.equal(
		plain(failureText(theme, failures, true))
			.split("\n")
			.at(-1),
		"✗ Script error: Error: thrown",
	);
	// pi puts the message on the line after "Script error:".
	const content = [
		{
			type: "text",
			text: "Script failed\nWall time 7.1 seconds\nOutput:\n\nScript error:\nError: thrown\n    at <anonymous> (codemode.js:10:11)",
		},
	];
	assert.deepEqual(failuresOf(content, undefined, true), [{ label: "Script error:", error: "Error: thrown" }]);
});

test("the summary is drawn in the accent color beside a muted label", () => {
	const summary = { status: "done" as const, text: "Read files" };
	const done = headerText(theme, "done", summary, false);
	assert.ok(done.includes(theme.fg("accent", "Read files")));
	assert.ok(done.includes(theme.fg("muted", "Codemode executed:")));
	const running = headerText(theme, "executing", summary, false);
	assert.ok(running.includes(theme.fg("accent", "Read files")));
	assert.ok(running.includes(theme.fg("muted", "Executing code:")));
	// Without a summary, the label keeps its normal emphasis.
	assert.ok(
		headerText(theme, "done", undefined, true).includes(theme.fg("toolTitle", theme.bold("Codemode failed"))),
	);
});

test("failure lines are faint and dim, with only the ✗ mark in the error color", () => {
	const text = failureText(
		theme,
		[
			...Array.from({ length: 4 }, (_, i) => ({ label: `bash c${i}`, error: "boom" })),
			{ label: "Script error:", error: "Error: thrown" },
		],
		false,
	);
	const lines = text.split("\n");
	const mark = theme.fg("error", "✗");
	assert.equal(lines[0], `${mark} ${faint(theme.fg("dim", "bash c0 — boom"))}`);
	assert.equal(lines[3], faint(theme.fg("dim", "+1 more failed")));
	assert.equal(lines[4], `${mark} ${faint(theme.fg("dim", "Script error: Error: thrown"))}`);
	assert.ok(!text.includes(theme.fg("text", "boom")));
});
