import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";
import { codeKey, ENTRY_TYPE } from "./explain.ts";

// Never read the developer's real settings.
const agentDir = mkdtempSync(join(tmpdir(), "codemode-explain-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const settings = (value: object) => writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
settings({});

type Handler = (event: any, ctx: any) => unknown;

function harness() {
	const handlers = new Map<string, Handler>();
	const entries: { customType: string; data: any }[] = [];
	let resolver: ((name: string, next: () => unknown) => unknown) | undefined;
	extension({
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerToolRenderer: (r: typeof resolver) => void (resolver = r),
		appendEntry: (customType: string, data: unknown) => void entries.push({ customType, data }),
	} as never);
	return { handlers, entries, resolver: resolver! };
}

const haiku = { provider: "anthropic", id: "claude-haiku", input: ["text"], cost: { input: 1, output: 5 } };
const opus = { provider: "anthropic", id: "claude-opus", input: ["text"], cost: { input: 15, output: 75 } };

function ctx(reply: () => Promise<object>, stored: object[] = []) {
	const notices: string[] = [];
	const requests: any[] = [];
	return {
		notices,
		requests,
		mode: "tui",
		model: opus,
		ui: { notify: (text: string) => notices.push(text) },
		sessionManager: { getEntries: () => stored },
		modelRegistry: {
			getAvailable: () => [opus, haiku],
			streamSimple: (model: unknown, context: unknown, options: unknown) => {
				requests.push({ model, context, options });
				return { result: reply };
			},
		},
	};
}

const call = (code: unknown, toolName = "codemode") => ({
	type: "tool_call",
	toolName,
	toolCallId: "1",
	input: { code },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("only wraps the codemode renderer", () => {
	const { resolver } = harness();
	const native = { renderCall() {}, renderResult() {} };
	assert.equal(
		resolver("bash", () => native),
		native,
	);
	assert.equal(
		resolver("codemode", () => undefined),
		undefined,
	);
	const wrapped = resolver("codemode", () => native) as typeof native;
	assert.notEqual(wrapped.renderCall, native.renderCall);
	assert.notEqual(wrapped.renderResult, native.renderResult);
});

test("summarizes each new script once with a cheap model and stores the result", async () => {
	const { handlers, entries } = harness();
	const c = ctx(async () => ({ stopReason: "stop", content: [{ type: "text", text: "Read a file." }] }));
	handlers.get("session_start")!({}, c);
	assert.equal(handlers.get("tool_call")!(call("await tools.read({path:'a'})"), c), undefined);
	handlers.get("tool_call")!(call("await tools.read({path:'a'})"), c);
	handlers.get("tool_call")!(call("ignored", "bash"), c);
	handlers.get("tool_call")!(call(42), c);
	await settle();
	assert.equal(c.requests.length, 1);
	assert.equal(c.requests[0].model, haiku);
	assert.deepEqual(entries, [
		{
			customType: ENTRY_TYPE,
			data: {
				key: codeKey("await tools.read({path:'a'})"),
				summary: "Read a file",
				model: "anthropic/claude-haiku",
			},
		},
	]);
});

test("stored summaries are reused after a restart, and non-TUI modes make no requests", async () => {
	const { handlers } = harness();
	const stored = [{ type: "custom", customType: ENTRY_TYPE, data: { key: codeKey("x"), summary: "Do x" } }];
	const c = ctx(async () => ({ stopReason: "stop", content: [] }), stored);
	handlers.get("session_start")!({}, c);
	handlers.get("tool_call")!(call("x"), c);
	handlers.get("tool_call")!(call("y"), { ...c, mode: "print" });
	await settle();
	assert.equal(c.requests.length, 0);
});

test("uses the configured model and warns when it is unavailable", async () => {
	const { handlers } = harness();
	const c = ctx(async () => ({ stopReason: "stop", content: [{ type: "text", text: "Go" }] }));
	handlers.get("session_start")!({}, c);
	try {
		settings({ codemodeExplain: { model: "anthropic/claude-opus" } });
		handlers.get("tool_call")!(call("p"), c);
		settings({ codemodeExplain: { model: "openai/missing" } });
		handlers.get("tool_call")!(call("q"), c);
		handlers.get("tool_call")!(call("r"), c);
	} finally {
		settings({});
	}
	await settle();
	assert.deepEqual(
		c.requests.map((r) => r.model),
		[opus],
	);
	assert.deepEqual(c.notices, ["codemode-explain: openai/missing is not available"]);
});

test("warns once on failure and drops results that land after the session ended", async () => {
	const { handlers, entries } = harness();
	const failing = ctx(async () => ({ stopReason: "error", errorMessage: "no credits", content: [] }));
	handlers.get("session_start")!({}, failing);
	handlers.get("tool_call")!(call("a"), failing);
	handlers.get("tool_call")!(call("b"), failing);
	await settle();
	assert.deepEqual(failing.notices, ["codemode-explain: anthropic/claude-haiku failed: no credits"]);

	let finish: (value: object) => void = () => {};
	const slow = ctx(() => new Promise((resolve) => (finish = resolve)));
	handlers.get("session_start")!({}, slow);
	handlers.get("tool_call")!(call("c"), slow);
	handlers.get("session_shutdown")!({}, slow);
	finish({ stopReason: "stop", content: [{ type: "text", text: "late" }] });
	await settle();
	assert.deepEqual(entries, []);
	assert.equal(slow.requests[0].options.signal.aborted, true);
});
