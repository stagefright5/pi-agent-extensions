import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension, { appendProviderLog, MAX_LOG_BYTES } from "./index.ts";

test("logs dispatched models once per request off the request path and drains at shutdown", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-log-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "new-profile");
	try {
		const handlers = new Map<string, Function>();
		extension({ on: (name: string, fn: Function) => handlers.set(name, fn) } as never);
		const ctx = {
			model: { provider: "virtual", id: "auto", baseUrl: "wrong" },
			hasUI: false,
			modelRegistry: {
				find: (provider: string, id: string) => {
					assert.equal(provider, "physical");
					assert.equal(id, "model");
					return { baseUrl: "https://example.invalid/v1" };
				},
			},
		};
		const event = { provider: "physical", model: "model", data: {} };
		assert.equal(handlers.get("before_provider_request")!({}, ctx), undefined);
		assert.equal(handlers.get("provider_stream_event")!(event, ctx), undefined);
		handlers.get("provider_stream_event")!(event, ctx);
		handlers.get("before_provider_request")!({}, ctx);
		handlers.get("provider_stream_event")!(event, ctx);
		await handlers.get("session_shutdown")!({}, ctx);
		const path = join(root, "new-profile", "provider-urls.log");
		const text = await readFile(path, "utf8");
		assert.match(text, /physical\/model https:\/\/example.invalid\/v1/);
		assert.doesNotMatch(text, /virtual|wrong/);
		assert.equal(text.trim().split("\n").length, 2);
		if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

test("failed background writes tolerate revoked UI and cannot poison the queue", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-error-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		const blocked = join(root, "not-a-directory");
		await writeFile(blocked, "blocked");
		for (const phase of ["active", "shutdown"]) {
			process.env.PI_CODING_AGENT_DIR = blocked;
			const handlers = new Map<string, Function>();
			extension({ on: (name: string, fn: Function) => handlers.set(name, fn) } as never);
			let touches = 0;
			let attempted!: () => void;
			const notice = new Promise<void>((resolve) => {
				attempted = resolve;
			});
			const ctx = {
				get hasUI() {
					touches++;
					attempted();
					throw new Error("stale context");
				},
				modelRegistry: { find: () => ({ baseUrl: "https://example.invalid" }) },
			};
			const event = { provider: "p", model: "m" };
			handlers.get("provider_stream_event")!(event, ctx);
			if (phase === "active") {
				await notice;
				process.env.PI_CODING_AGENT_DIR = join(root, "recovered");
				handlers.get("before_provider_request")!();
				handlers.get("provider_stream_event")!(event, ctx);
			}
			await handlers.get("session_shutdown")!();
			assert.equal(touches, phase === "active" ? 1 : 0);
		}
		assert.match(await readFile(join(root, "recovered", "provider-urls.log"), "utf8"), /p\/m/);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

test("log rotation is bounded and concurrent writers retain all new lines", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-rotate-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "provider-urls.log");
	await writeFile(path, "x".repeat(MAX_LOG_BYTES));
	await Promise.all(Array.from({ length: 10 }, (_, i) => appendProviderLog(root, `request-${i}\n`)));
	assert.equal((await stat(`${path}.1`)).size, MAX_LOG_BYTES);
	const lines = (await readFile(path, "utf8")).trim().split("\n").sort();
	assert.deepEqual(lines, Array.from({ length: 10 }, (_, i) => `request-${i}`).sort());
});
