import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanSummary,
	codeKey,
	toolKey,
	parseModelRef,
	pickModel,
	summarize,
	SummaryStore,
	type ChatModel,
} from "./explain.ts";

const CODE = Array.from({ length: 20 }, (_, i) => `const v${i} = await tools.read({ path: "f${i}" });`).join("\n");

const model = (provider: string, id: string, input: number, output: number, extra = {}) =>
	({ provider, id, input: ["text"], cost: { input, output, cacheRead: 0, cacheWrite: 0 }, ...extra }) as ChatModel;

test("model choice: configured, then cheapest same-provider text model, then the session model", () => {
	const opus = model("anthropic", "claude-opus", 15, 75);
	const haiku = model("anthropic", "claude-haiku", 1, 5);
	const sonnet = model("anthropic", "claude-sonnet", 3, 15);
	const cheapOther = model("openai", "gpt-nano", 0.1, 0.4);
	const visionOnly = model("anthropic", "pixels", 0, 0, { input: ["image"] });
	const available = [opus, sonnet, haiku, cheapOther, visionOnly];
	assert.equal(pickModel(opus, available), haiku);
	assert.equal(pickModel(opus, available, { provider: "openai", id: "gpt-nano" }), cheapOther);
	assert.equal(pickModel(opus, available, { provider: "openai", id: "missing" }), undefined);
	assert.equal(pickModel(undefined, available), undefined);
	assert.equal(pickModel(opus, []), opus);
	// Subscription models can have equal prices.
	const free = [model("x", "big", 0, 0), model("x", "big-mini", 0, 0)];
	assert.equal(pickModel(free[0], free)?.id, "big-mini");
});

test("model references and summaries are normalized", () => {
	assert.deepEqual(parseModelRef("openrouter/google/gemini-flash"), {
		provider: "openrouter",
		id: "google/gemini-flash",
	});
	for (const bad of [undefined, 3, "", "noslash", "/id", "provider/"]) assert.equal(parseModelRef(bad), undefined);
	assert.equal(
		cleanSummary('\n  - Summary: "Read config files and report versions."\nmore'),
		"Read config files and report versions",
	);
	assert.equal(cleanSummary("\u001b[31m**List MCP tools**\u001b[0m"), "List MCP tools");
	assert.equal(cleanSummary("   "), "");
	// The renderer wraps long summaries.
	assert.equal(cleanSummary("word ".repeat(60)), "word ".repeat(60).trim());
	assert.equal(codeKey("a"), codeKey("a"));
	assert.notEqual(codeKey("a"), codeKey("b"));
	assert.equal(toolKey("codemode", { code: "x" }), codeKey("x"));
	assert.equal(
		toolKey("bash", { command: "ls", nested: { b: 1, a: 2 } }),
		toolKey("bash", { nested: { a: 2, b: 1 }, command: "ls" }),
	);
	assert.notEqual(toolKey("read", { path: "a" }), toolKey("write", { path: "a" }));
	assert.notEqual(toolKey("read", { path: "a" }), toolKey("read", { path: "b" }));
	assert.notEqual(toolKey("x", [1, 2]), toolKey("x", [2, 1]));
});

test("summarize sends the script without reasoning and rejects provider failures", async () => {
	let seen: { context: any; options: any } | undefined;
	const registry = (message: object) => ({
		streamSimple: (_model: unknown, context: unknown, options: unknown) => {
			seen = { context, options };
			return { result: async () => message };
		},
	});
	const ok = registry({ stopReason: "stop", content: [{ type: "text", text: "Read twenty files." }] });
	const signal = new AbortController().signal;
	assert.equal(await summarize(ok as never, model("a", "b", 0, 0), CODE, signal), "Read twenty files");
	assert.equal(seen?.context.messages[0].content[0].text, CODE);
	assert.equal(seen?.options.signal, signal);
	assert.equal(seen?.options.reasoning, undefined);
	const huge = "x".repeat(20_000);
	await summarize(ok as never, model("a", "b", 0, 0), huge, signal);
	assert.match(seen?.context.messages[0].content[0].text, /8000 more characters$/);
	const failed = registry({ stopReason: "error", errorMessage: "rate limited", content: [] });
	await assert.rejects(summarize(failed as never, model("a", "b", 0, 0), CODE, signal), /rate limited/);
	const empty = registry({ stopReason: "stop", content: [{ type: "text", text: " " }] });
	await assert.rejects(summarize(empty as never, model("a", "b", 0, 0), CODE, signal), /empty summary/);
});

test("the store redraws waiting rows only once and forgets them on clear", () => {
	const store = new SummaryStore();
	let calls = 0;
	store.set("k", { status: "pending" });
	store.wait("k", () => calls++);
	store.set("k", { status: "pending" });
	assert.equal(calls, 0);
	store.set("k", { status: "done", text: "x" });
	store.set("k", { status: "done", text: "y" });
	assert.equal(calls, 1);
	store.wait("k", () => calls++);
	store.clear();
	store.set("k", { status: "done", text: "z" });
	assert.equal(calls, 1);
	assert.deepEqual(store.get("k"), { status: "done", text: "z" });
});
