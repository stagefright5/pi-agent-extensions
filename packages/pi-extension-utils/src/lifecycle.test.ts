import assert from "node:assert/strict";
import test from "node:test";
import { createUsageTracker, notifyIfActive, EXTENSION_USAGE_TYPE } from "./index.ts";

test("cancelled work reports usage during shutdown before the owner is revoked", async () => {
	const entries: unknown[] = [];
	const tracker = createUsageTracker({ appendEntry: (...args: unknown[]) => entries.push(args) } as never, "summary");
	const usage = { cost: { total: 0.25 } };
	let finish!: () => void;
	const work = tracker.track(
		new Promise<void>((resolve) => {
			finish = resolve;
		}).then(() => {
			tracker.record(usage as never);
			throw new Error("aborted");
		}),
	);
	const draining = tracker.drain();
	finish();
	await assert.rejects(work, /aborted/);
	await draining;
	assert.deepEqual(entries, [[EXTENSION_USAGE_TYPE, { source: "summary", usage }]]);
	tracker.record(usage as never);
	assert.equal(entries.length, 1, "a closed tracker cannot write into a replacement session");
});

test("shutdown has a bounded grace and ignores usage from providers that finish too late", async () => {
	let writes = 0;
	const tracker = createUsageTracker({ appendEntry: () => writes++ } as never, "summary");
	let finish!: () => void;
	const work = tracker.track(
		new Promise<void>((resolve) => {
			finish = resolve;
		}).then(() => {
			tracker.record({ cost: { total: 1 } } as never);
		}),
	);
	await tracker.drain(10);
	finish();
	await work;
	assert.equal(writes, 0);
});

test("retired notifications never touch the context and revoked getters cannot reject detached work", () => {
	const controller = new AbortController();
	let touches = 0;
	const ctx = {
		get hasUI() {
			touches++;
			throw new Error("stale context");
		},
	};
	assert.doesNotThrow(() => notifyIfActive(controller.signal, ctx as never, "failed"));
	assert.equal(touches, 1);
	controller.abort();
	notifyIfActive(controller.signal, ctx as never, "late failure");
	assert.equal(touches, 1);
});

test("notification transport failures are best-effort too", () => {
	assert.doesNotThrow(() =>
		notifyIfActive(
			new AbortController().signal,
			{
				hasUI: true,
				ui: {
					notify() {
						throw new Error("UI gone");
					},
				},
			} as never,
			"failed",
		),
	);
});
