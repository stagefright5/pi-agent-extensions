import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { captureFork, writeChildSession } from "./fork.ts";
import { createSideAgent, latestCompletedResponse, RESULT_TYPE, SENT_TYPE, SEND_TOOL, type Dialogs } from "./index.ts";
import { LAUNCH_FLAG } from "./launch.ts";
import { MAX_RESULT_BYTES, SideAgentStore, type InboxMessage, type LiveRecord, type RexPane } from "./store.ts";

process.env.REX_SESSION = "session:s";
process.env.REX_BLOCK = "block:parent";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() }) as never;
const assistant = (text: string, extra: object = {}) =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "x",
		provider: "anthropic",
		model: "m",
		usage,
		stopReason: "stop",
		timestamp: Date.now(),
		...extra,
	}) as never;
const waitFor = async (condition: () => boolean, what: string, ms = 3000) => {
	const deadline = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

class FakeRex {
	instance = "srv";
	panes = new Map<string, { pids: number[]; label?: string }>([["block:parent", { pids: [process.pid] }]]);
	splits: Array<{ label: string; command: readonly string[]; cwd: string }> = [];
	focused: string[] = [];
	closed: string[] = [];
	splitMode: "ok" | "timeout-created" | "timeout-none" = "ok";
	async self(): Promise<RexPane> {
		return {
			serverInstanceId: this.instance,
			sessionId: "session:s",
			windowId: "window:w",
			blockId: "block:parent",
		};
	}
	async split(options: { label: string; command: readonly string[]; cwd: string }) {
		this.splits.push(options);
		if (this.splitMode === "timeout-none") return undefined;
		const id = `block:child-${this.splits.length}`;
		this.panes.set(id, { pids: [], label: options.label });
		return this.splitMode === "ok" ? id : undefined;
	}
	async findByLabel(_session: string, label: string) {
		return [...this.panes].find(([, pane]) => pane.label === label)?.[0];
	}
	async exists(pane: RexPane) {
		return pane.serverInstanceId === this.instance && this.panes.has(pane.blockId);
	}
	async hosts(pane: RexPane, pid: number) {
		return (await this.exists(pane)) && !!this.panes.get(pane.blockId)?.pids.includes(pid);
	}
	async focus(pane: RexPane) {
		if (!this.panes.has(pane.blockId)) throw new Error("gone");
		this.focused.push(pane.blockId);
	}
	async closeBlock(pane: RexPane) {
		this.closed.push(pane.blockId);
		this.panes.delete(pane.blockId);
	}
	async process(pane: RexPane) {
		return { pids: this.panes.get(pane.blockId)?.pids ?? [], exitCode: null };
	}
}

type Answers = {
	select: Array<(options: { options: readonly { value: unknown }[] }) => unknown>;
	confirm: boolean[];
	editor: Array<(prefill: string) => string | undefined | Promise<string | undefined>>;
	document: Array<"accept" | "dismiss" | "cancel">;
};

function workspace(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "side-life-"));
	const store = new SideAgentStore(join(root, "side-agent"));
	const rex = new FakeRex();
	const parent = SessionManager.create(root, join(root, "sessions"));
	parent.appendMessage(user("Investigate the flaky test"));
	parent.appendMessage(assistant("It races on the cache"));
	const instances: Array<{ emit(name: string, event?: object): Promise<void> }> = [];
	t.after(async () => {
		for (const instance of instances) await instance.emit("session_shutdown");
		rmSync(root, { recursive: true, force: true });
	});
	function agent(
		sm: SessionManager,
		options: { flags?: Record<string, string>; active?: string[]; timing?: object } = {},
	) {
		const handlers = new Map<string, Array<(event: object, ctx: object) => unknown>>();
		let command: { handler(args: string, ctx: object): Promise<void> } | undefined;
		const answers: Answers = { select: [], confirm: [], editor: [], document: [] };
		const sent: Array<[{ customType: string; details?: { messageId?: string } }, unknown]> = [];
		const notes: string[] = [];
		const tools = new Map<string, ToolDefinition>();
		const state = { idle: true, shutdown: 0, aborted: 0 };
		const pi = {
			on(name: string, handler: (event: object, ctx: object) => unknown) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
				return () => {};
			},
			registerFlag() {},
			registerTool(tool: ToolDefinition) {
				tools.set(tool.name, tool);
			},
			getFlag: (name: string) => options.flags?.[name],
			registerMessageRenderer() {},
			registerCommand(_name: string, value: typeof command) {
				command = value;
			},
			getAllTools: () => [
				{ name: "read", exposure: "direct" },
				{ name: "bash", exposure: "direct" },
				...tools.values(),
			],
			getActiveTools: () => [
				...(options.active ?? ["read", "bash"]),
				...[...tools.values()].filter((tool) => tool.exposure === "direct").map((tool) => tool.name),
			],
			getThinkingLevel: () => "high",
			sendMessage(
				message: { customType: string; content: string; display: boolean; details?: object },
				opts: unknown,
			) {
				sent.push([message, opts]);
				sm.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
			},
			appendEntry: (type: string, data: unknown) => sm.appendCustomEntry(type, data),
		};
		const ctx = {
			mode: "tui",
			hasUI: true,
			sessionManager: sm,
			ui: {
				notify: (message: string) => notes.push(message),
				setStatus() {},
				theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s },
			},
			isIdle: () => state.idle,
			isProjectTrusted: () => true,
			model: { provider: "anthropic", id: "m" },
			modelRegistry: { hasConfiguredAuth: () => true },
			abort: () => state.aborted++,
			shutdown: () => state.shutdown++,
		};
		const dialogs: Dialogs = {
			select: (async (_ctx: unknown, opts: never) => answers.select.shift()?.(opts)) as never,
			confirm: (async () => answers.confirm.shift() ?? false) as never,
			editor: (async (_ctx: unknown, opts: { prefill?: string }) =>
				answers.editor.shift()?.(opts.prefill ?? "")) as never,
			showDocument: (async () => answers.document.shift() ?? "cancel") as never,
		};
		createSideAgent(pi as never, {
			store,
			rex: rex as never,
			argv: [],
			piCommand: () => ["/node", "/pi/cli.js"],
			dialogs,
			timing: { ackTimeoutMs: 1500, closeGraceMs: 400, validationWindowMs: 300, pollMs: 50, ...options.timing },
		});
		const emit = async (name: string, event: object = {}) => {
			for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
		};
		instances.push({ emit });
		const run = (args = "") => command!.handler(args, ctx);
		const input = async () => {
			let result: unknown;
			for (const handler of handlers.get("input") ?? [])
				result = (await handler({ type: "input", text: "hi", source: "interactive" }, ctx)) ?? result;
			return result;
		};
		const send = (text: string, signal?: AbortSignal) =>
			tools.get(SEND_TOOL)!.execute("send-call", { text }, signal, undefined, ctx as never);
		return { emit, run, input, answers, sent, notes, state, sm, tools, send, ctx, pi };
	}
	return { root, store, rex, parent, agent };
}

const parentId = (sm: SessionManager) => sm.getSessionId();
const ackLaunch = (store: SideAgentStore, childSessionId: string, extra: Partial<LiveRecord> = {}) => {
	const lock = store.readLaunch(childSessionId)!;
	store.writeLive({
		version: 1,
		childSessionId,
		parentSessionId: lock.parentSessionId,
		pid: process.pid,
		token: lock.token,
		rexBlockId: lock.childPane?.blockId,
		rexSessionId: "session:s",
		startedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		state: "ready",
		busy: false,
		...extra,
	});
	return lock;
};

test("/side new forks once into a right split with the exact child session and a launch token", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start", { reason: "startup" });
	const parentBytes = readFileSync(parent.getSessionFile()!, "utf8");
	await main.run("new");
	assert.equal(rex.splits.length, 1);
	const [child] = store.listChildren(parentId(parent));
	assert.ok(child);
	const { command, cwd } = rex.splits[0];
	assert.equal(cwd, parent.getCwd());
	assert.equal(command[command.indexOf("--session") + 1], child.childSessionFile);
	const token = command[command.indexOf(`--${LAUNCH_FLAG}`) + 1];
	assert.equal(store.readLaunch(child.childSessionId)?.token, token);
	assert.equal(store.readParent(parentId(parent)).pane?.childSessionId, child.childSessionId);
	assert.equal(readFileSync(parent.getSessionFile()!, "utf8"), parentBytes, "the parent transcript is never written");

	// Ready acknowledgement releases the reservation.
	ackLaunch(store, child.childSessionId);
	await waitFor(() => !store.readLaunch(child.childSessionId), "launch release");

	// One managed pane: a second fork is refused, /side focuses the existing pane.
	await main.run("new");
	assert.equal(rex.splits.length, 1);
	assert.match(main.notes.at(-1)!, /already open/);
	await main.run("");
	assert.deepEqual(rex.focused, ["block:child-1"]);
});

test("concurrent /side commands in one process run one operation", async (t) => {
	const { rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await Promise.all([main.run("new"), main.run("new")]);
	assert.equal(rex.splits.length, 1);
	assert.ok(main.notes.some((note) => /in progress/.test(note)));
});

test("a manually closed pane is reopened from the saved child, not forked again; reload keeps the link", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	ackLaunch(store, child.childSessionId);
	await waitFor(() => !store.readLaunch(child.childSessionId), "launch release");
	store.removeLive(child.childSessionId, process.pid);
	rex.panes.delete("block:child-1");

	await main.run("");
	assert.equal(rex.splits.length, 2);
	assert.equal(store.listChildren(parentId(parent)).length, 1, "no new fork");
	assert.equal(rex.splits[1].command[rex.splits[1].command.indexOf("--session") + 1], child.childSessionFile);
	assert.equal(store.readLaunch(child.childSessionId)?.expectation.mode, "reopen");

	// Restarted parent: a new extension instance finds and focuses the live pane.
	await main.emit("session_shutdown");
	const restarted = agent(SessionManager.open(parent.getSessionFile()!));
	await restarted.emit("session_start", { reason: "startup" });
	await restarted.run("");
	assert.equal(rex.splits.length, 2);
	assert.deepEqual(rex.focused, ["block:child-2"]);
});

test("a child already running elsewhere is focused or reported, never launched twice", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	ackLaunch(store, child.childSessionId);
	await waitFor(() => !store.readLaunch(child.childSessionId), "launch release");
	store.setPane(parentId(parent), undefined);
	// Running in a known pane that hosts its PID: adopt and focus.
	rex.panes.get("block:child-1")!.pids.push(process.pid);
	main.answers.select.push((opts) => opts.options[0].value);
	await main.run("list");
	assert.equal(rex.splits.length, 1);
	assert.deepEqual(rex.focused, ["block:child-1"]);
	// Running in a pane we cannot prove: report, do not open a second writer.
	store.setPane(parentId(parent), undefined);
	rex.panes.get("block:child-1")!.pids = [];
	main.answers.select.push((opts) => opts.options[0].value);
	await main.run("list");
	assert.equal(rex.splits.length, 1);
	assert.match(main.notes.at(-1)!, /another Pi process/);
});

test("launch reservations: a live launcher blocks; a dead one's surviving pane is adopted", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	// Simulate a different process mid-launch (alive owner, fresh reservation).
	store.setPane(parentId(parent), undefined);
	rex.panes.delete("block:child-1");
	await main.run("");
	assert.equal(rex.splits.length, 1);
	assert.match(main.notes.at(-1)!, /already being opened/);
	// The owner died after creating a pane.
	const lock = store.readLaunch(child.childSessionId)!;
	store.releaseLaunch(child.childSessionId, lock.token);
	rex.panes.set("block:orphan", { pids: [], label: lock.label });
	store.acquireLaunch({ ...lock, ownerPid: 2 ** 22 + 7, childPane: { ...lock.parentPane, blockId: "block:orphan" } });
	await main.run("");
	assert.equal(rex.splits.length, 1);
	assert.equal(store.readParent(parentId(parent)).pane?.pane.blockId, "block:orphan");
	assert.equal(store.readLaunch(child.childSessionId), undefined);
});

test("an ambiguous split is reconciled by label; a missing pane opens nothing", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	rex.splitMode = "timeout-created";
	await main.run("new");
	assert.equal(rex.splits.length, 1);
	assert.equal(store.readParent(parentId(parent)).pane?.pane.blockId, "block:child-1");

	const other = workspace(t);
	const second = other.agent(other.parent);
	await second.emit("session_start");
	other.rex.splitMode = "timeout-none";
	await second.run("new");
	const [child] = other.store.listChildren(parentId(other.parent));
	assert.equal(other.store.readParent(parentId(other.parent)).pane, undefined);
	assert.equal(other.store.readLaunch(child.childSessionId), undefined, "reservation released");
	assert.match(second.notes.at(-1)!, /nothing was opened/);
});

test("a busy parent forks from its last completed turn", async (t) => {
	const { store, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.emit("agent_start");
	main.state.idle = false;
	parent.appendMessage(user("Long refactor"));
	parent.appendMessage(
		assistant("", {
			content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }],
			stopReason: "toolUse",
		}),
	);
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	const text = readFileSync(child.childSessionFile, "utf8");
	assert.ok(text.includes("It races on the cache"));
	assert.ok(!text.includes("Long refactor"));
});

test("close asks the child to exit, then closes exactly its pane; busy children need confirmation", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	const lock = ackLaunch(store, child.childSessionId, { busy: true });
	await waitFor(() => !store.readLaunch(child.childSessionId), "launch release");
	rex.panes.get("block:child-1")!.pids.push(process.pid);

	main.answers.confirm.push(false);
	await main.run("close");
	assert.deepEqual(rex.closed, [], "declined: nothing closed");

	main.answers.confirm.push(true);
	const closing = main.run("close");
	await waitFor(() => !!store.takeControl(child.childSessionId, lock.token) || false, "shutdown request", 1000).catch(
		() => {},
	);
	store.removeLive(child.childSessionId, process.pid); // the child exits
	await closing;
	assert.deepEqual(rex.closed, ["block:child-1"]);
	assert.equal(store.readParent(parentId(parent)).pane, undefined);
	assert.ok(rex.panes.has("block:parent"), "the parent pane is never touched");
});

test("a child that does not exit is force-closed only after explicit confirmation", async (t) => {
	const { store, rex, parent, agent } = workspace(t);
	const main = agent(parent);
	await main.emit("session_start");
	await main.run("new");
	const [child] = store.listChildren(parentId(parent));
	ackLaunch(store, child.childSessionId);
	await waitFor(() => !store.readLaunch(child.childSessionId), "launch release");
	rex.panes.get("block:child-1")!.pids.push(process.pid);
	main.answers.confirm.push(false);
	await main.run("close");
	assert.deepEqual(rex.closed, []);
	assert.ok(store.readParent(parentId(parent)).pane);
	main.answers.confirm.push(true);
	await main.run("close");
	assert.deepEqual(rex.closed, ["block:child-1"]);
});

function makeChild(env: ReturnType<typeof workspace>) {
	const snapshot = captureFork(env.parent, { idle: true });
	assert.ok(snapshot.ok);
	const created = writeChildSession(snapshot.snapshot, { title: "Side: test" });
	env.store.writeChild({
		version: 1,
		childSessionId: created.childSessionId,
		childSessionFile: created.childSessionFile,
		parentSessionId: env.parent.getSessionId(),
		parentSessionFile: env.parent.getSessionFile()!,
		parentLeafId: null,
		boundaryId: snapshot.snapshot.boundaryId,
		cwd: env.parent.getCwd(),
		title: "Side: test",
		createdAt: new Date().toISOString(),
	});
	return created;
}

const result = (
	env: ReturnType<typeof workspace>,
	childId: string,
	childFile: string,
	extra: Partial<InboxMessage> = {},
): InboxMessage => ({
	version: 1,
	messageId: `m-${Math.random().toString(16).slice(2)}`,
	parentSessionId: env.parent.getSessionId(),
	childSessionId: childId,
	childSessionFile: childFile,
	sourceEntryId: "e",
	forkBoundaryId: "b",
	title: "Side: test",
	text: "The fix is in cache.ts",
	edited: false,
	createdAt: new Date().toISOString(),
	...extra,
});

const imported = (sm: SessionManager) =>
	sm.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === RESULT_TYPE);

test("inbox: preview cancel keeps it pending; accept imports once, attributed, without a model turn", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const main = env.agent(env.parent);
	await main.emit("session_start");
	const message = result(env, child.childSessionId, child.childSessionFile);
	env.store.postResult(message);
	await waitFor(() => main.notes.some((note) => /\/side inbox/.test(note)), "notification");

	main.answers.select.push(
		(opts) => opts.options[0].value,
		() => undefined,
	);
	main.answers.document.push("cancel");
	await main.run("inbox");
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 1);

	main.answers.select.push((opts) => opts.options[0].value);
	main.answers.document.push("accept");
	await main.run("inbox");
	assert.equal(main.sent.length, 1);
	assert.equal(main.sent[0][1], undefined, "no triggerTurn or delivery option: never starts a run");
	const [entry] = imported(env.parent);
	assert.ok(entry && entry.type === "custom_message");
	assert.match(String(entry.content), /not an instruction from the user/);
	assert.equal((entry.details as { childSessionId: string }).childSessionId, child.childSessionId);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "delivered").length, 1);

	// Re-delivery of the same message ID is acknowledged, not appended.
	const root = join(env.root, "side-agent", "inbox", env.parent.getSessionId());
	copyFileSync(
		join(root, "delivered", `${message.messageId}.json`),
		join(root, "accepted", `${message.messageId}.json`),
	);
	await main.emit("agent_settled", { aborted: false });
	assert.equal(imported(env.parent).length, 1);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "accepted").length, 0);
});

test("inbox: a busy parent keeps accepted results until it settles; dismiss and wrong parents never import", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const main = env.agent(env.parent);
	await main.emit("session_start");
	env.store.postResult(result(env, child.childSessionId, child.childSessionFile));
	env.store.postResult(result(env, child.childSessionId, child.childSessionFile, { text: "dismiss me" }));
	env.store.postResult(result(env, "stranger", "/tmp/x.jsonl"));
	env.store.postResult({
		...result(env, child.childSessionId, child.childSessionFile),
		parentSessionId: "someone-else",
	});

	main.state.idle = false;
	main.answers.select.push(
		(opts) => opts.options[0].value,
		(opts) => opts.options[0].value,
	);
	main.answers.document.push("accept", "dismiss");
	await main.run("inbox");
	assert.equal(main.sent.length, 0, "busy: retained durably");
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "accepted").length, 1);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "dismissed").length, 1);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "rejected").length, 1, "unknown child quarantined");
	main.state.idle = true;
	await main.emit("agent_settled", { aborted: false });
	assert.equal(main.sent.length, 1);
	assert.equal(imported(env.parent).length, 1);
});

test("crash between import and acknowledgement: restart reconciles from the transcript", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const message = result(env, child.childSessionId, child.childSessionFile);
	env.store.postResult(message);
	env.store.moveInbox(env.parent.getSessionId(), message.messageId, "pending", "accepted");
	env.parent.appendCustomMessageEntry(RESULT_TYPE, "imported", true, { messageId: message.messageId });
	const main = env.agent(env.parent);
	await main.emit("session_start");
	assert.equal(main.sent.length, 0);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "delivered").length, 1);
});

test("child: validates before readiness, sends edited results, honours shutdown and focuses its parent", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const token = "tok-1";
	env.store.acquireLaunch({
		version: 1,
		childSessionId: child.childSessionId,
		parentSessionId: env.parent.getSessionId(),
		token,
		label: "pi-side-tok",
		ownerPid: process.pid,
		createdAt: new Date().toISOString(),
		parentPane: { serverInstanceId: "srv", sessionId: "session:s", windowId: "window:w", blockId: "block:parent" },
		parentPid: process.pid,
		expectation: {
			mode: "fork",
			model: { provider: "anthropic", id: "m" },
			thinkingLevel: "high",
			tools: { active: ["bash", "read"], callable: ["bash", "read"], configured: ["bash", "read"] },
		},
	});
	const sm = SessionManager.open(child.childSessionFile);
	const side = env.agent(sm, { flags: { [LAUNCH_FLAG]: token } });
	await side.emit("session_start", { reason: "startup" });
	await waitFor(() => env.store.readLive(child.childSessionId)?.state === "ready", "ready");
	assert.equal(await side.input(), undefined, "ready children accept prompts");
	const live = env.store.readLive(child.childSessionId)!;
	assert.equal(live.token, token);
	assert.equal(live.rexBlockId, "block:parent", "the child reports the pane Rex gave it");

	// Send: cancel, then an edited result.
	assert.equal(latestCompletedResponse(sm.getBranch())?.text, "It races on the cache");
	side.answers.editor.push(() => undefined);
	await side.run("send");
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 0);
	side.answers.editor.push((prefill) => `${prefill}\n\nVerified.`);
	await side.run("send");
	const [sent] = env.store.listInbox(env.parent.getSessionId(), "pending");
	assert.equal(sent.edited, true);
	assert.equal(sent.childSessionId, child.childSessionId);
	assert.ok(sm.getEntries().some((entry) => entry.type === "custom" && entry.customType === SENT_TYPE));

	// Nested management is refused; /side parent proves and focuses the launcher's pane.
	await side.run("new");
	assert.match(side.notes.at(-1)!, /cannot manage/);
	await side.run("parent");
	assert.deepEqual(env.rex.focused, ["block:parent"]);

	env.store.requestControl(child.childSessionId, {
		version: 1,
		token: "wrong",
		command: "shutdown",
		abort: false,
		requestedAt: "",
	});
	await new Promise((resolve) => setTimeout(resolve, 1200));
	assert.equal(side.state.shutdown, 0);
	env.store.requestControl(child.childSessionId, {
		version: 1,
		token,
		command: "shutdown",
		abort: true,
		requestedAt: "",
	});
	await waitFor(() => side.state.shutdown === 1, "graceful shutdown", 2500);
	await side.emit("session_shutdown");
	assert.equal(env.store.readLive(child.childSessionId), undefined);
});

test("child: configuration differences need explicit acceptance; a second writer is blocked", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	env.store.acquireLaunch({
		version: 1,
		childSessionId: child.childSessionId,
		parentSessionId: env.parent.getSessionId(),
		token: "tok",
		label: "l",
		ownerPid: process.pid,
		createdAt: new Date().toISOString(),
		parentPane: { serverInstanceId: "srv", sessionId: "session:s", windowId: "window:w", blockId: "block:parent" },
		parentPid: process.pid,
		expectation: { mode: "fork", tools: { active: ["read"], callable: ["read"], configured: ["read"] } },
	});
	const sm = SessionManager.open(child.childSessionFile);
	const side = env.agent(sm, { flags: { [LAUNCH_FLAG]: "tok" } });
	side.answers.confirm.push(false);
	await side.emit("session_start");
	assert.deepEqual(await side.input(), { action: "handled" }, "no prompts before readiness");
	await assert.rejects(side.send("hi"), /configuration check/);
	await waitFor(() => env.store.readLive(child.childSessionId)?.state === "rejected", "rejection");
	assert.match(
		env.store.readLive(child.childSessionId)!.issues!.join(),
		/active here but not in the main agent: bash/,
	);
	assert.equal(side.state.shutdown, 1);
	await assert.rejects(side.send("hi"), /configuration check/);
	await side.emit("session_shutdown");

	// Another live process owns the transcript: this one must not write.
	env.store.writeLive({
		version: 1,
		childSessionId: child.childSessionId,
		parentSessionId: env.parent.getSessionId(),
		pid: process.ppid,
		startedAt: "",
		updatedAt: new Date().toISOString(),
		state: "ready",
		busy: false,
	});
	const duplicate = env.agent(SessionManager.open(child.childSessionFile));
	await duplicate.emit("session_start");
	assert.deepEqual(await duplicate.input(), { action: "handled" });
	assert.equal(env.store.readLive(child.childSessionId)?.pid, process.ppid, "the owner's heartbeat is untouched");
	await assert.rejects(duplicate.send("hi"), /already open/);
	await duplicate.run("send");
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 0);
});

test("side_agent_send queues exact text with session-derived provenance; only explicit parent acceptance imports it", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const main = env.agent(env.parent);
	await main.emit("session_start");
	assert.equal(main.tools.has(SEND_TOOL), false, "not registered in main sessions");
	const sm = SessionManager.open(child.childSessionFile);
	const side = env.agent(sm);
	await side.emit("session_start");
	const tool = side.tools.get(SEND_TOOL)!;
	assert.equal(tool.exposure, "direct", "callable directly and through codemode");
	assert.deepEqual(Object.keys(tool.parameters.properties), ["text"]);
	assert.equal(tool.parameters.additionalProperties, false);
	assert.match(tool.promptGuidelines!.join(" "), /explicitly asks/);
	assert.match(tool.promptGuidelines!.join(" "), /Never write Side Agent inbox/);
	const source = sm.appendMessage(user("send hi to main agent"));
	side.state.idle = false; // Sending must work during the child's tool execution.
	const bytesBefore = readFileSync(env.parent.getSessionFile()!, "utf8");
	const response = await side.send("hi");
	const [message] = env.store.listInbox(env.parent.getSessionId(), "pending");
	assert.equal(message.text, "hi");
	assert.equal(message.childSessionId, child.childSessionId);
	assert.equal(message.childSessionFile, child.childSessionFile);
	assert.equal(message.sourceEntryId, source);
	assert.equal(message.forkBoundaryId, env.store.readChild(child.childSessionId)!.boundaryId);
	assert.equal((response.details as { messageId: string }).messageId, message.messageId);
	assert.match(JSON.stringify(response.content), /only if accepted/);
	assert.equal(readFileSync(env.parent.getSessionFile()!, "utf8"), bytesBefore);
	assert.equal(main.sent.length, 0);
	assert.equal(side.sent.length, 0);
	main.answers.select.push((opts) => opts.options[0].value);
	main.answers.document.push("accept");
	await main.run("inbox");
	assert.equal(imported(env.parent).length, 1);
	assert.equal(main.sent[0][1], undefined, "no model turn");
	await main.run("inbox");
	assert.equal(imported(env.parent).length, 1);
});

test("send rejects invalid text, cancelled calls, lost ownership and inconsistent linkage without writes", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const sm = SessionManager.open(child.childSessionFile);
	const side = env.agent(sm);
	await side.emit("session_start");
	const before = readFileSync(child.childSessionFile, "utf8");
	await assert.rejects(side.send(" \n\t"), /empty/);
	await assert.rejects(side.send("é".repeat(MAX_RESULT_BYTES / 2 + 1)), /limit/);
	await assert.rejects(side.send("hi", AbortSignal.abort()), /cancelled/);
	const owner = env.store.readLive(child.childSessionId)!;
	env.store.writeLive({ ...owner, token: "different-launch" });
	await assert.rejects(side.send("hi"), /no longer owns/);
	env.store.writeLive(owner);
	const record = env.store.readChild(child.childSessionId)!;
	env.store.writeChild({ ...record, parentSessionId: "unrelated" });
	await assert.rejects(side.send("hi"), /linkage/);
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 0);
	assert.equal(env.store.listInbox("unrelated", "pending").length, 0);
	assert.equal(readFileSync(child.childSessionFile, "utf8"), before);
	env.store.writeChild(record);
	await side.send("x".repeat(MAX_RESULT_BYTES));
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 1, "exact byte limit is allowed");
});

test("send is withdrawn after session replacement and stale tool/editor callbacks cannot write", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const side = env.agent(SessionManager.open(child.childSessionFile));
	await side.emit("session_start");
	const staleTool = side.tools.get(SEND_TOOL)!;
	let finish!: (text: string) => void;
	side.answers.editor.push(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const editing = side.run("send");
	await waitFor(() => !!finish, "send editor");
	await side.emit("session_shutdown");
	side.ctx.sessionManager = env.parent;
	await side.emit("session_start");
	assert.equal(side.tools.get(SEND_TOOL)!.exposure, "hidden");
	await assert.rejects(side.send("hi"), /only inside/);
	await assert.rejects(
		staleTool.execute("old-call", { text: "hi" }, undefined, undefined, side.ctx as never),
		/no longer active/,
	);
	finish("hi");
	await editing;
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 0);
});

test("a committed send still succeeds if saving the local receipt fails", async (t) => {
	const env = workspace(t);
	const child = makeChild(env);
	const side = env.agent(SessionManager.open(child.childSessionFile));
	await side.emit("session_start");
	side.pi.appendEntry = () => {
		throw new Error("receipt unavailable");
	};
	await side.send("hi");
	assert.equal(env.store.listInbox(env.parent.getSessionId(), "pending").length, 1);
	assert.match(side.notes.at(-1)!, /Message queued, but its local receipt/);
});
