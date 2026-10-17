import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import extension from "./index.ts";
test("uses merged defaults and saves toggles privately without modifying shared settings", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-fast-settings-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		const path = join(dir, "settings.json");
		writeFileSync(path, '{"theme":"dark","unrelated":true}');
		const before = readFileSync(path, "utf8");
		const handlers = new Map<string, Function>();
		let command: Function;
		const statuses: unknown[] = [];
		extension({
			on: (name: string, fn: Function) => handlers.set(name, fn),
			registerFlag() {},
			getFlag: () => false,
			getSettings: () => ({ openaiFast: true }),
			registerCommand: (_name: string, opts: { handler: Function }) => {
				command = opts.handler;
			},
		} as never);
		const ctx = {
			model: { provider: "openai" },
			ui: { setStatus: (_id: string, value: unknown) => statuses.push(value), notify() {} },
		};
		handlers.get("session_start")!({}, ctx);
		assert.equal(statuses.at(-1), "⚡︎");
		await command!("", ctx);
		assert.equal(readFileSync(path, "utf8"), before);
		const saved = join(dir, "openai-fast.json");
		assert.deepEqual(JSON.parse(readFileSync(saved, "utf8")), { enabled: false });
		if (process.platform !== "win32") assert.equal(statSync(saved).mode & 0o777, 0o600);
		handlers.get("session_start")!({}, ctx);
		assert.equal(statuses.at(-1), undefined, "saved override wins over legacy default");
		handlers.get("session_shutdown")!({}, ctx);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
