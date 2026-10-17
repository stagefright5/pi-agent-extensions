import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import {
	createEditToolDefinition,
	createReadToolDefinition,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { SummaryStore, toolKey } from "./explain.ts";
import { explainRenderers, stopAnimations } from "./renderer.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { initTheme, theme } = await import(new URL("modes/interactive/theme/theme.js", host).href);
initTheme("dark");
const render = (component: { render(width: number): string[] }, width = 80) =>
	component
		.render(width)
		.map((line) => plain(line).trimEnd())
		.join("\n");

function row(name: string, native: ToolRenderers = {}, args: object = { path: "file.ts" }) {
	const store = new SummaryStore();
	const renderers = explainRenderers(native, store, name);
	const context = {
		args,
		state: {},
		cwd: "/tmp",
		toolCallId: "1",
		invalidate() {},
		lastComponent: undefined,
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		durationMs: 123,
		outputPad: 1,
	};
	return {
		store,
		renderers,
		context,
		call: () => renderers.renderCall!(args, theme, context),
		result: (text: string, details?: unknown) =>
			renderers.renderResult!({ content: [{ type: "text", text }], details }, context, theme, context),
	};
}

test("generic rows hide raw arguments/output, wrap summaries, and expand native content", () => {
	const native = {
		renderCall: () => new Text("native arguments", 0, 0),
		renderResult: () => new Text("native output", 0, 0),
	};
	const r = row("bash", native, { command: "ls" });
	r.store.set(toolKey("bash", r.context.args), {
		status: "done",
		text: "List files in the current working directory",
	});
	const call = r.call();
	assert.match(render(call), /✓ bash tool completed: List files/);
	assert.doesNotMatch(render(call), /native arguments/);
	for (const line of call.render(15)) assert.ok(visibleWidth(line) <= 15);
	assert.match(render(call, 15).replace(/\s+/g, " "), /current working directory/);
	assert.equal(render(r.result("secret output")).trim(), "Took 123ms");
	r.context.expanded = true;
	assert.match(render(r.call()), /native arguments/);
	assert.equal(render(r.result("secret output")), "native output");
});

test("fallback tools preserve raw JSON and text on expansion and show failures collapsed", () => {
	const r = row("mcp__test__search", {}, { query: "hello" });
	assert.equal(render(r.call()), "✓ mcp__test__search tool completed");
	r.context.isError = true;
	const call = r.call();
	assert.match(render(r.result("Access denied\nstack trace")), /tool failed · Took 123ms/);
	assert.match(render(call), /✗ mcp__test__search tool failed\n✗ mcp__test__search — Access denied/);
	assert.doesNotMatch(render(call), /stack trace/);
	r.context.expanded = true;
	assert.match(render(r.call()), /"query": "hello"/);
	assert.match(render(r.result("Access denied\nstack trace")), /stack trace/);
});

test("real read and self-shell edit renderers remain usable when expanded", () => {
	const read = row("read", createReadToolDefinition("/tmp"));
	read.context.expanded = true;
	assert.match(render(read.call()), /file.ts/);
	assert.match(render(read.result("read contents")), /read contents/);
	const edit = row("edit", createEditToolDefinition("/tmp"), {
		path: "file.ts",
		edits: [{ oldText: "old", newText: "new" }],
	});
	assert.equal(edit.renderers.renderShell, "default");
	assert.doesNotMatch(render(edit.call()), /old|new/);
	const details = { diff: "-1 old\n+1 new", firstChangedLine: 1 };
	assert.doesNotMatch(render(edit.result("replaced", details)), /old|new/);
	edit.context.expanded = true;
	const expandedCall = edit.call();
	edit.result("replaced", details);
	// Pi's edit renderer puts the final diff in its call component, not its result slot.
	assert.match(render(expandedCall), /old/);
	assert.match(render(expandedCall), /new/);
});

test("generic rows animate writing, executing and summary pending phases", (t) => {
	t.after(stopAnimations);
	const r = row("write");
	r.context.isPartial = true;
	r.context.argsComplete = false;
	assert.match(render(r.call()), /Calling write tool/);
	r.context.argsComplete = true;
	assert.match(render(r.call()), /Running write tool/);
	r.context.isPartial = false;
	r.store.set(toolKey("write", r.context.args), { status: "pending" });
	assert.match(render(r.call()), /✓ write tool completed:/);
	r.store.set(toolKey("write", r.context.args), { status: "failed" });
	assert.equal(render(r.call()), "✓ write tool completed");
});
