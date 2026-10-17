import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";
import { codeKey, ENTRY_TYPE, toolKey } from "./explain.ts";

// Isolate tests from the user's agent settings.
const agentDir = mkdtempSync(join(tmpdir(), "tool-explain-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const settings = (value: object) => writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
settings({});

type Handler = (event: any, ctx: any) => unknown;

function harness() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, { handler: Handler }>();
	const entries: { customType: string; data: any }[] = [];
	let resolver: ((name: string, next: () => unknown) => unknown) | undefined;
	extension({
		on: (name: string, handler: Handler) => void handlers.set(name, handler),
		registerCommand: (name: string, command: { handler: Handler }) => void commands.set(name, command),
		getAllTools: () => [{ name: "bash", description: "Execute shell commands" }],
		registerToolRenderer: (r: typeof resolver) => void (resolver = r),
		appendEntry: (customType: string, data: unknown) => void entries.push({ customType, data }),
	} as never);
	return { handlers, entries, commands, resolver: resolver! };
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

test("wraps all tools including self-shell and not-yet-registered MCP tools", () => {
	const { resolver, commands } = harness();
	assert.ok(commands.has("tool-explain"));
	for (const name of ["codemode", "bash", "edit", "mcp__future__search"]) {
		const native = { renderShell: "self", renderCall() {}, renderResult() {} };
		const wrapped = resolver(name, () => native) as typeof native;
		assert.notEqual(wrapped.renderCall, native.renderCall);
		assert.notEqual(wrapped.renderResult, native.renderResult);
		assert.equal(wrapped.renderShell, "default");
		assert.ok(resolver(name, () => undefined));
	}
});

test("summarizes each new script once with a cheap model and stores the result", async () => {
	const { handlers, entries } = harness();
	const c = ctx(async () => ({ stopReason: "stop", content: [{ type: "text", text: "Read a file." }] }));
	handlers.get("session_start")!({}, c);
	assert.equal(handlers.get("tool_call")!(call("await tools.read({path:'a'})"), c), undefined);
	handlers.get("tool_call")!(call("await tools.read({path:'a'})"), c);
	handlers.get("tool_call")!({ ...call("ignored", "bash"), parentToolCallId: "parent" }, c);
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
		settings({ toolExplain: { model: "anthropic/claude-opus" } });
		handlers.get("tool_call")!(call("p"), c);
		settings({ toolExplain: { model: "openai/missing" } });
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
	assert.deepEqual(c.notices, ["tool-explain: openai/missing is not available"]);
});

test("warns once on failure and drops results that land after the session ended", async () => {
	const { handlers, entries } = harness();
	const failing = ctx(async () => ({ stopReason: "error", errorMessage: "no credits", content: [] }));
	handlers.get("session_start")!({}, failing);
	handlers.get("tool_call")!(call("a"), failing);
	handlers.get("tool_call")!(call("b"), failing);
	await settle();
	assert.deepEqual(failing.notices, ["tool-explain: anthropic/claude-haiku failed: no credits"]);

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

test("generic calls use tool identity, descriptions and arguments; reuse persisted summaries", async () => {
	const { handlers, entries } = harness();
	const c = ctx(async () => ({ stopReason: "stop", content: [{ type: "text", text: "List files" }] }));
	handlers.get("session_start")!({}, c);
	const event = { toolName: "bash", input: { command: "ls", timeout: 5 } };
	handlers.get("tool_call")!(event, c);
	handlers.get("tool_call")!({ ...event, input: { timeout: 5, command: "ls" } }, c);
	await settle();
	assert.equal(c.requests.length, 1);
	assert.deepEqual(JSON.parse(c.requests[0].context.messages[0].content[0].text), {
		tool: "bash",
		description: "Execute shell commands",
		arguments: event.input,
	});
	assert.match(c.requests[0].context.systemPrompt, /tool calls/);
	assert.equal(entries[0].data.key, toolKey("bash", event.input));
	const restored = ctx(
		async () => ({}),
		entries.map((e) => ({ type: "custom", ...e })),
	);
	handlers.get("session_start")!({}, restored);
	handlers.get("tool_call")!(event, restored);
	for (const mode of ["print", "json", "rpc"])
		handlers.get("tool_call")!({ toolName: "read", input: {} }, { ...restored, mode });
	assert.equal(restored.requests.length, 0);
});

test("unselected tools keep their renderers and never request summaries", () => {
	try {
		for (const selection of [{ tools: ["codemode"] }, { tools: "all", excludeTools: ["bash"] }, { tools: [] }]) {
			settings({ toolExplain: selection });
			const { handlers, resolver } = harness();
			const native = { renderShell: "self", renderCall() {} };
			assert.equal(
				resolver("bash", () => native),
				native,
			);
			const c = ctx(async () => ({}));
			handlers.get("session_start")!({}, c);
			handlers.get("tool_call")!({ toolName: "bash", input: { command: "ls" } }, c);
			assert.equal(c.requests.length, 0);
		}
	} finally {
		settings({});
	}
});

test("an aborted old request cannot delete a new session's pending summary", async () => {
	const { handlers, entries } = harness();
	let reject: (error: Error) => void = () => {};
	const old = ctx(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	handlers.get("session_start")!({}, old);
	handlers.get("tool_call")!(call("same"), old);
	let finish: (value: object) => void = () => {};
	const fresh = ctx(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	handlers.get("session_start")!({}, fresh);
	handlers.get("tool_call")!(call("same"), fresh);
	reject(new Error("aborted"));
	await settle();
	handlers.get("tool_call")!(call("same"), fresh);
	assert.equal(fresh.requests.length, 1);
	finish({ stopReason: "stop", content: [{ type: "text", text: "Do work" }] });
	await settle();
	assert.equal(entries.length, 1);
});

test("picker saves choices to agent settings and reloads only after a change", async () => {
	const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { initTheme, theme } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	initTheme("dark");
	const { loadSettings } = await import("./settings.ts");
	const { commands } = harness();
	let reloads = 0;
	let interact = (component: any) => {
		component.handleInput("\u001b[B"); // Select bash.
		component.handleInput("\r"); // Disable bash.
		assert.deepEqual(loadSettings().excludeTools, ["bash"]);
		component.handleInput("\u001b");
	};
	const c = {
		mode: "tui",
		waitForIdle: async () => {},
		reload: async () => {
			reloads++;
		},
		ui: {
			notify: () => {},
			custom: async (factory: any) => {
				let closed = false;
				const component = factory({ requestRender() {} }, theme, {}, () => {
					closed = true;
				});
				assert.ok(component.render(80).length);
				interact(component);
				assert.equal(closed, true);
			},
		},
	};
	try {
		await commands.get("tool-explain")!.handler("", c);
		assert.equal(reloads, 1);
		interact = (component) => component.handleInput("\u001b");
		await commands.get("tool-explain")!.handler("", c);
		assert.equal(reloads, 1);
		interact = (component) => {
			component.handleInput("\r"); // Switch to selected mode with bash disabled.
			assert.deepEqual(loadSettings().tools, []);
			component.handleInput("\u001b[B");
			component.handleInput("\r"); // Enable bash.
			assert.deepEqual(loadSettings().tools, ["bash"]);
			component.handleInput("\u001b");
		};
		await commands.get("tool-explain")!.handler("", c);
		assert.equal(reloads, 2);
	} finally {
		settings({});
	}
});
