import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import lockfile from "proper-lockfile";
import history, { historyIndexPath } from "./index.ts";

function harness() {
	const handlers = new Map<string, Function>();
	history({
		on: (name: string, fn: Function) => handlers.set(name, fn),
		events: { on() {}, emit() {} },
		registerCommand() {},
		registerShortcut() {},
	} as never);
	return handlers;
}

test("submission returns synchronously even while another process owns the history lock; shutdown drains", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-history-nonblocking-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	let release: (() => Promise<void>) | undefined;
	try {
		// Bootstrap the private directory without adding prompts.
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "prompt-history-search"));
		release = await lockfile.lock(historyIndexPath(), { realpath: false });
		const handlers = harness();
		const result = handlers.get("input")!(
			{ source: "interactive", text: "do not block" },
			{
				cwd: dir,
				hasUI: false,
				sessionManager: { getSessionFile: () => "s", getSessionName: () => undefined },
			},
		);
		assert.deepEqual(result, { action: "continue" });
		await release();
		release = undefined;
		await handlers.get("session_shutdown")!();
		const index = JSON.parse(await readFile(historyIndexPath(), "utf8"));
		assert.equal(index.prompts[0].text, "do not block");
	} finally {
		await release?.();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("failed detached writes never reject on revoked context or touch it after shutdown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-history-error-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		const blocked = join(dir, "not-a-directory");
		await writeFile(blocked, "blocked");
		process.env.PI_CODING_AGENT_DIR = blocked;
		for (const phase of ["active", "shutdown"]) {
			const handlers = harness();
			let touches = 0;
			let attempted!: () => void;
			const notice = new Promise<void>((resolve) => {
				attempted = resolve;
			});
			const ctx = {
				cwd: dir,
				get hasUI() {
					touches++;
					attempted();
					throw new Error("stale context");
				},
				sessionManager: { getSessionFile: () => "s", getSessionName: () => undefined },
			};
			handlers.get("input")!({ source: "interactive", text: "fail-" + phase }, ctx);
			if (phase === "active") await notice;
			await handlers.get("session_shutdown")!();
			assert.equal(touches, phase === "active" ? 1 : 0);
		}
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	}
});

test("independent Pi processes cannot overwrite each other's prompt updates", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "pi-history-processes-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const code = `
		import history from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
		const handlers = new Map();
		history({ on: (name, fn) => handlers.set(name, fn), events: { on() {}, emit() {} }, registerCommand() {}, registerShortcut() {} });
		const ctx = { cwd: '/project-' + process.env.WORKER, hasUI: false, sessionManager: { getSessionFile: () => process.env.WORKER, getSessionName: () => undefined } };
		for (let i = 0; i < 12; i++) handlers.get('input')({ source: 'interactive', text: process.env.WORKER + ':' + i }, ctx);
		await handlers.get('session_shutdown')();
	`;
	await Promise.all(
		Array.from(
			{ length: 4 },
			(_, worker) =>
				new Promise<void>((resolve, reject) => {
					const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
						env: { ...process.env, PI_CODING_AGENT_DIR: dir, WORKER: String(worker) },
						stdio: ["ignore", "ignore", "pipe"],
					});
					let error = "";
					child.stderr.on("data", (data) => {
						error += data;
					});
					child.on("error", reject);
					child.on("exit", (status) => (status === 0 ? resolve() : reject(new Error(error))));
				}),
		),
	);
	const index = JSON.parse(await readFile(join(dir, "prompt-history-search", "index.json"), "utf8"));
	assert.equal(index.prompts.length, 48);
	assert.equal(new Set(index.prompts.map((p: { text: string }) => p.text)).size, 48);
});
