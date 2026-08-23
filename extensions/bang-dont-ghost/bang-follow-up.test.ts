import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BashCompletionTracker, createEmptyFollowUpRequest } from "./bang-follow-up.ts";
import bangDontGhostExtension from "./index.ts";

function bashEntry(
	id: string,
	command: string,
	options: { cancelled?: boolean; excludeFromContext?: boolean; exitCode?: number } = {},
): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			role: "bashExecution",
			command,
			output: "output",
			exitCode: options.exitCode ?? 0,
			cancelled: options.cancelled ?? false,
			truncated: false,
			excludeFromContext: options.excludeFromContext,
			timestamp: Date.now(),
		},
	};
}

test("creates an empty hidden follow-up delivered through the follow-up queue", () => {
	assert.deepEqual(createEmptyFollowUpRequest(), {
		message: {
			customType: "bang-dont-ghost",
			content: [],
			display: false,
		},
		options: {
			triggerTurn: true,
			deliverAs: "followUp",
		},
	});
});

test("reports a completed single-bang command even when it exits nonzero", () => {
	const tracker = new BashCompletionTracker();
	const entries: SessionEntry[] = [bashEntry("old", "old command")];
	tracker.reset(entries);
	tracker.expect("npm test");

	entries.push(bashEntry("result", "npm test", { exitCode: 1 }));

	assert.deepEqual(tracker.scan(entries), [{ command: "npm test", entryId: "result" }]);
	assert.equal(tracker.hasPending(), false);
});

test("does not complete from double-bang output", () => {
	const tracker = new BashCompletionTracker();
	const entries: SessionEntry[] = [];
	tracker.reset(entries);
	tracker.expect("git status");

	entries.push(bashEntry("hidden", "git status", { excludeFromContext: true }));

	assert.deepEqual(tracker.scan(entries), []);
	assert.equal(tracker.hasPending(), true);
});

test("consumes cancelled commands without requesting a follow-up", () => {
	const tracker = new BashCompletionTracker();
	const entries: SessionEntry[] = [];
	tracker.reset(entries);
	tracker.expect("long task");

	entries.push(bashEntry("cancelled", "long task", { cancelled: true }));

	assert.deepEqual(tracker.scan(entries), []);
	assert.equal(tracker.hasPending(), false);
});

test("matches repeated commands to pending executions one at a time", () => {
	const tracker = new BashCompletionTracker();
	const entries: SessionEntry[] = [];
	tracker.reset(entries);
	tracker.expect("pwd");
	tracker.expect("pwd");

	entries.push(bashEntry("first", "pwd"));
	assert.deepEqual(tracker.scan(entries), [{ command: "pwd", entryId: "first" }]);
	assert.equal(tracker.hasPending(), true);

	entries.push(bashEntry("second", "pwd"));
	assert.deepEqual(tracker.scan(entries), [{ command: "pwd", entryId: "second" }]);
	assert.equal(tracker.hasPending(), false);
});

test("starts a follow-up after Pi records a single-bang result", async () => {
	type Handler = (event: never, context: never) => unknown;
	const handlers = new Map<string, Handler>();
	const sent: unknown[] = [];
	const entries: SessionEntry[] = [];
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	const context = {
		sessionManager: { getEntries: () => entries },
	};

	bangDontGhostExtension(pi);
	const sessionStart = handlers.get("session_start");
	const userBash = handlers.get("user_bash");
	const sessionShutdown = handlers.get("session_shutdown");
	assert.ok(sessionStart && userBash && sessionShutdown);

	sessionStart({} as never, context as never);
	userBash({ command: "npm test", excludeFromContext: false } as never, context as never);
	entries.push(bashEntry("result", "npm test"));

	await new Promise((resolve) => setTimeout(resolve, 20));
	sessionShutdown({} as never, context as never);

	assert.deepEqual(sent, [createEmptyFollowUpRequest()]);
});

test("does not watch double-bang commands", async () => {
	type Handler = (event: never, context: never) => unknown;
	const handlers = new Map<string, Handler>();
	const sent: unknown[] = [];
	const entries: SessionEntry[] = [];
	const pi = {
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		sendMessage(message: unknown, options: unknown) {
			sent.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	const context = {
		sessionManager: { getEntries: () => entries },
	};

	bangDontGhostExtension(pi);
	const sessionStart = handlers.get("session_start");
	const userBash = handlers.get("user_bash");
	const sessionShutdown = handlers.get("session_shutdown");
	assert.ok(sessionStart && userBash && sessionShutdown);

	sessionStart({} as never, context as never);
	userBash({ command: "git status", excludeFromContext: true } as never, context as never);
	entries.push(bashEntry("hidden", "git status", { excludeFromContext: true }));

	await new Promise((resolve) => setTimeout(resolve, 20));
	sessionShutdown({} as never, context as never);

	assert.deepEqual(sent, []);
});
