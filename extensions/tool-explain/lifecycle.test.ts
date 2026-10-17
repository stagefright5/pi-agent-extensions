import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import extension from "./index.ts";

test("settings actions run only after session_start and refresh on reload", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	const dir = mkdtempSync(join(tmpdir(), "tool-explain-lifecycle-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		const handlers = new Map<string, Function>();
		let ready = false;
		let reads = 0;
		let invalid = false;
		const notices: string[] = [];
		extension({
			on: (name: string, fn: Function) => handlers.set(name, fn),
			registerCommand() {},
			registerToolRenderer() {},
			getSettings() {
				assert.equal(ready, true, "action API called during extension loading");
				reads++;
				return { toolExplain: invalid ? false : { tools: "all" } };
			},
		} as never);
		assert.equal(reads, 0);
		ready = true;
		const ctx = {
			mode: "tui",
			ui: { notify: (text: string) => notices.push(text) },
			sessionManager: { getEntries: () => [] },
		};
		handlers.get("session_start")!({}, ctx);
		assert.equal(reads, 1);
		assert.deepEqual(notices, []);
		invalid = true;
		handlers.get("session_start")!({}, ctx);
		assert.equal(notices.length, 1);
		invalid = false;
		handlers.get("session_start")!({}, ctx);
		assert.equal(reads, 3);
		assert.equal(notices.length, 1, "an old startup error must not survive reload");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
});
