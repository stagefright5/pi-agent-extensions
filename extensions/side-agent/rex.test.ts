import assert from "node:assert/strict";
import test from "node:test";
import { RexClient, RexError, type Exec, type ExecResult } from "./rex.ts";

const ok = (stdout: unknown): ExecResult => ({
	code: 0,
	stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
	stderr: "",
	timedOut: false,
	missing: false,
});
const fail = (stderr: string, code = 1): ExecResult => ({ code, stdout: "", stderr, timedOut: false, missing: false });
const env = {
	REX_SESSION: "session:s1",
	REX_BLOCK: "block:parent",
	REX_BIN_DIR: "/opt/rex bin",
};
const who = { instance_id: "srv-1", session_id: "session:s1", window_id: "window:w1", block_id: "block:parent" };
const pane = { serverInstanceId: "srv-1", sessionId: "session:s1", windowId: "window:w1", blockId: "block:child" };

function client(respond: (args: readonly string[]) => ExecResult | Promise<ExecResult>, extraEnv = {}) {
	const calls: Array<{ command: string; args: readonly string[] }> = [];
	const exec: Exec = async (command, args) => {
		calls.push({ command, args });
		return respond(args);
	};
	return { rex: new RexClient({ exec, env: { ...env, ...extraEnv } }), calls };
}

function router(routes: Record<string, ExecResult | ((args: readonly string[]) => ExecResult)>) {
	return (args: readonly string[]) => {
		const key = args[0] === "api" ? "version" : args[0] === "block" ? `block ${args[1]}` : args[0];
		const route = routes[key];
		if (!route) throw new Error(`unexpected rex ${args.join(" ")}`);
		return typeof route === "function" ? route(args) : route;
	};
}

test("self() is resolved from REX_* and confirmed by whoami on a supported server", async () => {
	const { rex, calls } = client(router({ version: ok({ api_revision: 10 }), whoami: ok(who) }));
	assert.deepEqual(await rex.self(), {
		serverInstanceId: "srv-1",
		sessionId: "session:s1",
		windowId: "window:w1",
		blockId: "block:parent",
	});
	assert.equal(calls[0].command, "/opt/rex bin/rex");
	const stale = client(
		router({ version: ok({ api_revision: 10 }), whoami: ok({ ...who, block_id: "block:other" }) }),
	);
	await assert.rejects(stale.rex.self(), (error: RexError) => error.kind === "unavailable");
	const outside = client(() => ok(who), { REX_BLOCK: "" });
	await assert.rejects(outside.rex.self(), /inside a Rex terminal pane/);
	const old = client(router({ version: ok({ api_revision: 9 }) }));
	await assert.rejects(old.rex.self(), (error: RexError) => error.kind === "unsupported");
});

test("missing CLI and malformed JSON are distinct, actionable errors", async () => {
	const missing = client(() => ({ code: null, stdout: "", stderr: "", timedOut: false, missing: true }));
	await assert.rejects(missing.rex.self(), (error: RexError) => error.kind === "missing");
	const garbled = client(router({ version: ok("not json") }));
	await assert.rejects(garbled.rex.self(), (error: RexError) => error.kind === "malformed");
});

test("split names the explicit anchor and passes cwd and command words verbatim", async () => {
	const command = ["/usr/bin/env", "A=b c;$(x)", "/path with space/node", "--session", "/s/it's here.jsonl"];
	const { rex, calls } = client(
		router({ split: ok({ anchor_id: "block:parent", block_ids: ["block:child"], split_ids: [], revision: 3 }) }),
	);
	const block = await rex.split({
		anchor: { ...pane, blockId: "block:parent" },
		cwd: "/work/dir with 'quotes' & $vars",
		label: "pi-side-1",
		command,
	});
	assert.equal(block, "block:child");
	const args = calls[0].args;
	assert.deepEqual(args.slice(0, 4), ["split", "-s", "session:s1", "-b"]);
	assert.equal(args[4], "block:parent");
	assert.ok(args.includes("--split=right") && args.includes("--json"));
	assert.equal(args[args.indexOf("-c") + 1], "/work/dir with 'quotes' & $vars");
	assert.deepEqual(args.slice(args.indexOf("--") + 1), command);
});

test("split outcomes: timeout and unparseable output are ambiguous; wrong anchor and failures throw", async () => {
	const anchor = { ...pane, blockId: "block:parent" };
	const args = { anchor, cwd: "/", label: "l", command: ["pi"] };
	const timeout = client(() => ({ ...fail("Error: context deadline exceeded"), timedOut: false }));
	assert.equal(await timeout.rex.split(args), undefined);
	const killed = client(() => ({ code: null, stdout: "", stderr: "", timedOut: true, missing: false }));
	assert.equal(await killed.rex.split(args), undefined);
	const garbled = client(() => ok("{"));
	assert.equal(await garbled.rex.split(args), undefined);
	const wrong = client(() => ok({ anchor_id: "block:elsewhere", block_ids: ["block:x"] }));
	await assert.rejects(wrong.rex.split(args), /different pane/);
	const gone = client(() => fail('Error: block target "block:parent" not found', 3));
	await assert.rejects(gone.rex.split(args), (error: RexError) => error.kind === "not-found");
});

test("timeout reconciliation finds exactly one pane by its unique launch label", async () => {
	const listing = ok({
		blocks: [
			{ block_id: "block:a", label: "shell" },
			{ block_id: "block:b", label: "pi-side-1234" },
		],
	});
	const { rex } = client(router({ "block ls": listing }));
	assert.equal(await rex.findByLabel("session:s1", "pi-side-1234"), "block:b");
	assert.equal(await rex.findByLabel("session:s1", "pi-side-none"), undefined);
	const twice = client(
		router({
			"block ls": ok({
				blocks: [
					{ block_id: "block:a", label: "dup" },
					{ block_id: "block:b", label: "dup" },
				],
			}),
		}),
	);
	await assert.rejects(twice.rex.findByLabel("session:s1", "dup"), /More than one/);
});

test("stale IDs: a restarted server or missing block is gone; ownership requires the PID in the pane", async () => {
	const inspect = ok({ block: { block_id: "block:child" } });
	const proc = ok({ child: { pid: 10 }, foreground: { pid: 20 }, ancestors: [{ pid: 30 }], last_exit: null });
	const { rex } = client(router({ whoami: ok(who), "block inspect": inspect, "block call": proc }));
	assert.equal(await rex.exists(pane), true);
	assert.equal(await rex.hosts(pane, 20), true);
	assert.equal(await rex.hosts(pane, 99), false, "a pane running someone else's process is not ours");
	assert.equal(await rex.exists({ ...pane, serverInstanceId: "old-server" }), false);
	const missing = client(
		router({ whoami: ok(who), "block inspect": fail('block target "block:child" not found', 3) }),
	);
	assert.equal(await missing.rex.exists(pane), false);
	const flaky = client(router({ whoami: ok(who), "block inspect": fail("connection refused") }));
	await assert.rejects(flaky.rex.exists(pane), (error: RexError) => error.kind === "failed");
});

test("close targets one full block ID and never a window or session", async () => {
	const { rex, calls } = client(() => ok(""));
	await rex.closeBlock(pane);
	assert.deepEqual(calls[0].args, ["block", "close", "-s", "session:s1", "block:child"]);
	await assert.rejects(rex.closeBlock({ ...pane, blockId: "window:w1" }), /non-block/);
	await rex.focus(pane);
	assert.deepEqual(calls[1].args, ["focus", "-s", "session:s1", "block:child"]);
});
