import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

test("logger creates the configured profile directory, not ~/.pi/agent", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-log-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "new-profile");
	try {
		const loaded = await discoverAndLoadExtensions(
			[fileURLToPath(new URL("./index.ts", import.meta.url))],
			root,
			join(root, "agent"),
		);
		assert.deepEqual(loaded.errors, []);
		const handler = loaded.extensions[0].handlers.get("before_provider_request")[0];
		await handler(
			{ type: "before_provider_request", payload: {} },
			{ model: { provider: "test", id: "model", baseUrl: "https://example.invalid/v1" } },
		);
		const text = await readFile(join(root, "new-profile", "provider-urls.log"), "utf8");
		assert.match(text, /test\/model https:\/\/example.invalid\/v1/);
		await handler({ type: "before_provider_request", payload: {} }, { model: undefined });
		assert.equal(await readFile(join(root, "new-profile", "provider-urls.log"), "utf8"), text);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});
