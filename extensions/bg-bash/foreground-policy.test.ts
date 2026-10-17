import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "./jobs.ts";
import { BACKGROUND_AFTER_SECONDS, createBashTool } from "./tools.ts";

async function fixture(t: import("node:test").TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "bg-bash-policy-"));
	const manager = new JobManager(join(dir, "logs"));
	t.after(async () => {
		await manager.reset();
		await rm(dir, { recursive: true, force: true });
	});
	const tool = createBashTool({ manager, session: () => "policy", shell: () => ({}) });
	const ctx = {
		cwd: dir,
		sessionManager: { getSessionId: () => "policy", getSessionFile: () => undefined },
	} as never;
	return { tool, manager, ctx };
}

test("wait is absent from the schema and stale overrides are discarded without mutating input", async (t) => {
	const { tool } = await fixture(t);
	assert.equal(BACKGROUND_AFTER_SECONDS, 10);
	assert.equal("wait" in tool.parameters.properties, false);
	assert.doesNotMatch(tool.promptGuidelines!.join("\n"), /Pass a larger|wait: 0/);
	for (const wait of [0, 600, null, -1, Infinity, "600"]) {
		const input = { command: "true", timeout: 60, wait };
		assert.deepEqual(tool.prepareArguments!(input), { command: "true", timeout: 60 });
		assert.equal(input.wait, wait);
	}
});

test("background completion must be verified before reporting success", async (t) => {
	const { tool } = await fixture(t);
	const guidance =
		"A background return is not a completion result. Use job_status to verify the exit code before reporting success.";
	assert.ok(tool.description.includes(guidance));
	assert.ok(tool.promptGuidelines!.includes(guidance));
});

test("direct execution cannot override the fixed threshold, even without argument preparation", async (t) => {
	const { tool, manager, ctx } = await fixture(t);
	const observed: number[] = [];
	const start = manager.start.bind(manager);
	manager.start = (options) => {
		const job = start(options);
		const original = job.waitForeground.bind(job);
		job.waitForeground = (milliseconds, signal) => {
			observed.push(milliseconds);
			return original(0, signal); // Accelerate only this unit test's scheduler.
		};
		return job;
	};
	for (const wait of [0, 600, -1, Infinity]) {
		const result = await tool.execute("policy", { command: "sleep 30", wait } as never, undefined, undefined, ctx);
		assert.equal(result.structuredContent?.running, true);
		assert.match(result.content[0].type === "text" ? result.content[0].text : "", /after 10s/);
	}
	assert.deepEqual(observed, [10_000, 10_000, 10_000, 10_000]);
});

test(
	"real scheduler backgrounds at 10 seconds despite wait:600 and a longer timeout",
	{ timeout: 25_000 },
	async (t) => {
		const { tool, ctx } = await fixture(t);
		const started = performance.now();
		const result = await tool.execute(
			"real-policy",
			{ command: "sleep 30", wait: 600, timeout: 60 } as never,
			undefined,
			undefined,
			ctx,
		);
		const elapsed = performance.now() - started;
		assert.equal(result.structuredContent?.running, true);
		assert.ok(result.structuredContent?.job_id);
		assert.ok(elapsed >= 9_000 && elapsed < 20_000, `foreground execution took ${elapsed}ms`);
	},
);
