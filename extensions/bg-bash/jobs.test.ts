import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import backgroundBash, { MESSAGE_TYPE } from "./index.ts";
import { JobManager, jobManager, lastLines, readJobOutput, TailRing } from "./jobs.ts";
import { createBashTool, createJobTools } from "./tools.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function until(check: () => boolean, ms = 5000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await sleep(20);
	}
}

const toolContext = (cwd = process.cwd()) =>
	({
		cwd,
		sessionManager: { getSessionId: () => "test-session", getSessionFile: () => undefined },
		model: undefined,
		thinkingLevel: undefined,
	}) as never;

type AnyTool = { name: string; execute: Function };
function tools(manager = new JobManager(mkdtempSync(join(tmpdir(), "bg-bash-test-")))) {
	const options = { manager, session: () => "test-session", shell: () => ({}) };
	const all = [createBashTool(options), ...createJobTools(options)] as unknown as AnyTool[];
	const byName = Object.fromEntries(all.map((tool) => [tool.name, tool]));
	const run = (name: string, params: object, signal?: AbortSignal) =>
		byName[name]!.execute("call", params, signal, undefined, toolContext()) as Promise<{
			content: { type: string; text: string }[];
			structuredContent?: Record<string, unknown>;
			details?: { job?: { id: string } };
			isError?: boolean;
		}>;
	return { manager, run };
}

test("tail ring keeps the newest bytes and drops the partial first line once trimmed", () => {
	const ring = new TailRing(16);
	ring.push(Buffer.from("line1\nline2\n"));
	assert.equal(ring.text(), "line1\nline2\n");
	ring.push(Buffer.from("line3\nline4\n"));
	assert.equal(ring.text(), "line3\nline4\n");
	ring.push(Buffer.from("tail-without-newline-xxxxxxxxxx\nend"));
	assert.equal(ring.bytes, 16);
	assert.equal(ring.text(), "end", "a cut mid-line drops the partial line");
	assert.equal(lastLines("a\nb\nc\n", 2), "b\nc");
});

test("a quick command returns like the built-in bash: output, exit code, no job", async () => {
	const { manager, run } = tools();
	const ok = await run("bash", { command: "echo hello", wait: null, timeout: null });
	assert.equal(ok.content[0]!.text, "hello\n");
	assert.equal(ok.structuredContent!.exit_code, 0);
	assert.equal(ok.structuredContent!.job_id, undefined);
	assert.equal(ok.isError, undefined);
	const failed = await run("bash", { command: "echo oops >&2; exit 3" });
	assert.equal(failed.isError, true);
	assert.match(failed.content[0]!.text, /^oops\n\n\nCommand exited with code 3$/u);
	assert.equal(failed.structuredContent!.exit_code, 3);
	assert.equal(manager.size, 0, "foreground commands are never listed");
	await assert.rejects(run("bash", { command: "true", timeout: -1 }), /Invalid timeout/u);
	await assert.rejects(run("bash", { command: "true", wait: Number.NaN }), /Invalid wait/u);
});

test("PI_* session environment still reaches commands", async () => {
	const { run } = tools();
	const result = await run("bash", { command: 'echo "$PI_SESSION_ID"' });
	assert.equal(result.content[0]!.text, "test-session\n");
});

test("a slow command moves to the background, keeps logging, and is unread when it finishes", async () => {
	const { manager, run } = tools();
	const changes: string[] = [];
	manager.onChange((job, change) => change === "state" && changes.push(`${job.id}:${job.state}`));
	const result = await run("bash", { command: "echo start; sleep 0.6; echo done", wait: 0.2 });
	const text = result.content[0]!.text;
	assert.match(
		text,
		/^start\n\n\n\[Still running in background as job j1 \(pid \d+\) after 0.2s\. Log: .+j1\.log\./u,
	);
	assert.equal(result.structuredContent!.running, true);
	assert.equal(result.structuredContent!.job_id, "j1");
	assert.equal(result.structuredContent!.exit_code, undefined);
	assert.equal(result.details!.job!.id, "j1");
	const job = manager.get("j1")!;
	assert.deepEqual(manager.counts(), { running: 1, unreadOk: 0, unreadFailed: 0 });
	await job.exited();
	await sleep(50);
	assert.equal(job.state, "exited");
	assert.equal(job.exitCode, 0);
	assert.equal(job.unread, true);
	assert.deepEqual(manager.counts(), { running: 0, unreadOk: 1, unreadFailed: 0 });
	assert.equal(readFileSync(job.logPath!, "utf8"), "start\ndone\n", "foreground output is flushed into the log");
	assert.deepEqual(changes, ["j1:running", "j1:exited"]);
	const status = await run("job_status", { id: "j1" });
	assert.match(status.content[0]!.text, /^j1 exited 0 · \d+s · pid \d+ · echo start; sleep 0\.6; echo done$/u);
	assert.equal(job.unread, false, "the agent reading it clears unread");
	assert.equal(job.agentSeen, true);
});

test("job_output reads tails, line ranges, and grep matches; unknown ids are structured errors", async () => {
	const { manager, run } = tools();
	await run("bash", { command: "for i in $(seq 1 50); do echo line $i; done; sleep 0.3", wait: 0.05 });
	const job = manager.get("j1")!;
	await job.exited();
	const tail = await run("job_output", { id: "j1", tail_lines: 3 });
	assert.match(tail.content[0]!.text, /\n\nline 48\nline 49\nline 50$/u);
	assert.equal(tail.structuredContent!.output, "line 48\nline 49\nline 50");
	const range = await run("job_output", { id: "j1", offset: 10, limit: 2 });
	assert.equal(range.structuredContent!.output, "line 10\nline 11");
	const grep = await run("job_output", { id: "j1", grep: "line 4[5-6]$" });
	assert.equal(grep.structuredContent!.output, "45: line 45\n46: line 46");
	for (const [name, params] of [
		["job_output", { id: "j9" }],
		["job_status", { id: "j9" }],
		["job_kill", { id: "j9" }],
	] as const) {
		const missing = await run(name, params);
		assert.equal(missing.isError, true);
		assert.match(String(missing.structuredContent!.error), /No background job "j9"\. Known jobs: j1\./u);
	}
	const nulls = await run("job_output", { id: "j1", tail_lines: 2, grep: null, offset: null, limit: null });
	assert.equal(nulls.structuredContent!.output, "line 49\nline 50", "null optional fields count as omitted");
	const all = await run("job_status", { id: null });
	assert.equal((all.structuredContent!.jobs as unknown[]).length, 1);
	const list = await run("job_list", {});
	assert.equal((list.structuredContent!.jobs as unknown[]).length, 1);
});

test("long logs: job_output reads only the file end", async () => {
	const { manager, run } = tools();
	await run("bash", {
		command: "sleep 0.2; for i in $(seq 1 20000); do echo line $i padding padding padding; done",
		wait: 0,
	});
	const job = manager.get("j1")!;
	await job.exited();
	await sleep(50);
	assert.equal(job.tailComplete, false);
	const read = await readJobOutput(job, { tailLines: 2 });
	assert.equal(read.text, "line 19999 padding padding padding\nline 20000 padding padding padding");
	const range = await run("job_output", { id: "j1", offset: 2, limit: 1 });
	assert.equal(range.structuredContent!.output, "line 2 padding padding padding");
});

test("job_kill stops the whole process group; killed jobs are neither unread nor notified", async () => {
	const { manager, run } = tools();
	const result = await run("bash", { command: "sleep 30 & echo $!; wait", wait: 0.3 });
	const child = Number(result.content[0]!.text.split("\n")[0]);
	assert.ok(alive(child));
	const killed = await run("job_kill", { id: "j1" });
	assert.equal(killed.structuredContent!.killed, true);
	assert.match(killed.content[0]!.text, /^Stopped j1 killed/u);
	await until(() => !alive(child));
	const job = manager.get("j1")!;
	assert.equal(job.state, "killed");
	assert.equal(job.unread, false);
	const again = await run("job_kill", { id: "j1" });
	assert.equal(again.structuredContent!.killed, false, "idempotent");
});

test("timeout keeps applying after the job moves to the background", async () => {
	const { manager, run } = tools();
	await run("bash", { command: "sleep 10", wait: 0.1, timeout: 0.5 });
	const job = manager.get("j1")!;
	await job.exited();
	assert.equal(job.state, "timed-out");
	assert.equal(job.unread, true);
	assert.deepEqual(manager.counts(), { running: 0, unreadOk: 0, unreadFailed: 1 });
	await assert.rejects(
		run("bash", { command: "sleep 10", timeout: 0.2, wait: 5 }),
		/Command timed out after 0.2 seconds/u,
	);
});

test("Esc during the wait kills the command; after backgrounding it has no effect", async () => {
	const { manager, run } = tools();
	const abort = new AbortController();
	setTimeout(() => abort.abort(), 150);
	const started = Date.now();
	await assert.rejects(run("bash", { command: "echo $$; sleep 10", wait: 5 }, abort.signal), /Command aborted/u);
	assert.ok(Date.now() - started < 2000);
	assert.equal(manager.size, 0);

	const later = new AbortController();
	await run("bash", { command: "sleep 0.5", wait: 0.05 }, later.signal);
	later.abort();
	const job = manager.get("j1")!;
	await job.exited();
	assert.equal(job.state, "exited", "the background job finished normally");
});

/** A fake pi runtime around the extension: tools, handlers, messages, statuses. */
function runtime(mode: "tui" | "print" = "print") {
	const handlers = new Map<string, Function>();
	const registered = new Map<string, AnyTool>();
	const messages: { message: { customType: string; content: string }; options: unknown }[] = [];
	const statuses: (string | undefined)[] = [];
	backgroundBash({
		registerTool: (tool: AnyTool) => registered.set(tool.name, tool),
		registerMessageRenderer() {},
		registerCommand() {},
		registerShortcut() {},
		on: (name: string, handler: Function) => handlers.set(name, handler),
		sendMessage: (message: never, options: unknown) => messages.push({ message, options }),
		sendUserMessage() {},
	} as never);
	const ctx = {
		mode,
		hasUI: true,
		cwd: process.cwd(),
		sessionManager: { getSessionId: () => "runtime-session", getSessionFile: () => undefined },
		ui: {
			theme: { fg: (_token: string, text: string) => text },
			setStatus: (_id: string, text?: string) => statuses.push(text),
			notify() {},
		},
	};
	return {
		start: () => handlers.get("session_start")!({}, ctx),
		shutdown: (reason: string) => handlers.get("session_shutdown")!({ reason }, ctx),
		run: (name: string, params: object) => registered.get(name)!.execute("call", params, undefined, undefined, ctx),
		messages,
		statuses,
		names: [...registered.keys()],
	};
}

test("extension: finish notifications, footer status, reload keeps jobs, quit kills them", async () => {
	const pi = runtime();
	assert.deepEqual(pi.names, ["bash", "job_status", "job_list", "job_output", "job_kill"]);
	pi.start();
	const manager = jobManager();
	try {
		await pi.run("bash", { command: "echo hi; sleep 0.3; echo bye", wait: 0.05 });
		assert.deepEqual(pi.statuses, ["● 1 running"]);
		const job = manager.get("j1")!;
		await job.exited();
		assert.equal(pi.messages.length, 1);
		const [{ message, options }] = pi.messages;
		assert.equal(message.customType, MESSAGE_TYPE);
		assert.match(
			message.content,
			/^Background job j1 exited with code 0 after \d+s: echo hi; sleep 0\.3; echo bye\nLog: .+\n\nLast 40 lines:\nhi\nbye$/u,
		);
		assert.deepEqual(options, { triggerTurn: true, deliverAs: "followUp" });
		assert.deepEqual(pi.statuses, ["● 1 running", "○1"], "unread success circle");

		// Killed jobs: no notification.
		await pi.run("bash", { command: "sleep 30", wait: 0 });
		await pi.run("job_kill", { id: "j2" });
		await manager.get("j2")!.exited();
		assert.equal(pi.messages.length, 1);

		// A stop from the jobs manager (the user) is reported, so the agent does not assume it still runs.
		await pi.run("bash", { command: "sleep 30", wait: 0 });
		const stopped = manager.get("j3")!;
		stopped.kill("user");
		await stopped.exited();
		assert.equal(pi.messages.length, 2);
		assert.match(
			pi.messages[1]!.message.content,
			/^Background job j3 was stopped by the user after \d+s: sleep 30\n/u,
		);
		assert.equal(stopped.unread, false, "the user knows: no footer circle");

		// Reload keeps a running job; the new runtime rebinds and reports its exit.
		await pi.run("bash", { command: "sleep 0.4", wait: 0 });
		const kept = manager.get("j4")!;
		pi.shutdown("reload");
		assert.equal(kept.state, "running");
		const next = runtime();
		next.start();
		await kept.exited();
		assert.equal(pi.messages.length, 2, "the old runtime no longer listens");
		assert.equal(next.messages.length, 1, "the new runtime notifies");

		await next.run("bash", { command: "sleep 30", wait: 0 });
		const doomed = manager.get("j5")!;
		next.shutdown("quit");
		await doomed.exited();
		assert.equal(doomed.state, "killed");
		assert.equal(manager.size, 0, "a new session starts with no jobs");
	} finally {
		manager.reset();
	}
});

test("reload adopts a manager and jobs built by the previous module, so new behavior applies", async () => {
	const registry = Symbol.for("@stagefright5/pi-bg-bash/v1");
	const store = globalThis as Record<symbol, unknown>;
	const previous = store[registry];
	// Stand-ins for the previous module's classes: same data, older methods (kill ignores who stopped it).
	const oldManager = new JobManager(mkdtempSync(join(tmpdir(), "bg-bash-adopt-")));
	const job = oldManager.start({
		command: "sleep 30",
		cwd: process.cwd(),
		shell: { shell: "/bin/bash", args: ["-c"] },
	});
	oldManager.background(job, "adopt");
	const OldJob = {
		kill(this: { killedByUser: boolean }) {
			this.killedByUser = true;
			return true;
		},
	};
	Object.setPrototypeOf(job, OldJob);
	Object.setPrototypeOf(oldManager, {});
	store[registry] = oldManager;
	try {
		const adopted = jobManager();
		assert.equal(adopted, oldManager, "same object: running processes and listeners carry over");
		assert.ok(adopted instanceof JobManager);
		assert.equal(adopted.get("j1"), job);
		assert.equal(job.kill("user"), true);
		assert.equal(job.stoppedBy, "user", "the current kill() runs on the adopted job");
		await job.exited();
		assert.equal(job.state, "killed");
	} finally {
		store[registry] = previous;
	}
});
