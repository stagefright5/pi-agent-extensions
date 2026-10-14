import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { discoverSessionFiles, historyIndexPath, loadPromptIndexForSearch } from "./index.ts";

test("history stays in the selected profile and includes custom session directories after bootstrap", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-history-profile-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "profile");
	try {
		const normalDir = join(root, "profile", "sessions", "project");
		const customDir = join(root, "custom-sessions");
		const laterDir = join(root, "another-custom-directory");
		for (const dir of [normalDir, customDir, laterDir]) await mkdir(dir, { recursive: true });
		for (const [dir, text] of [
			[normalDir, "normal prompt"],
			[customDir, "custom prompt"],
			[laterDir, "later prompt"],
		]) {
			const session = SessionManager.create(root, dir);
			session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
			// Sessions flush after the first assistant entry.
			session.appendMessage({
				role: "assistant",
				content: [],
				api: "openai-responses",
				provider: "openai",
				model: "test",
				stopReason: "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			});
		}
		assert.equal(historyIndexPath(), join(root, "profile", "prompt-history-search", "index.json"));
		assert.equal((await discoverSessionFiles()).length, 1);
		assert.equal((await discoverSessionFiles(customDir)).length, 1);
		const first = await loadPromptIndexForSearch(customDir);
		assert.deepEqual(first.prompts.map((p) => p.text).sort(), ["custom prompt", "normal prompt"]);
		const second = await loadPromptIndexForSearch(laterDir);
		assert.deepEqual(second.prompts.map((p) => p.text).sort(), ["custom prompt", "later prompt", "normal prompt"]);
		assert.equal(JSON.parse(await readFile(historyIndexPath(), "utf8")).prompts.length, 3);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});
