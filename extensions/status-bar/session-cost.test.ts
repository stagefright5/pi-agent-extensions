import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { EXTENSION_USAGE_TYPE } from "@stagefright5/pi-extension-utils";
import { createSessionCostReader, totalSessionCost } from "./session-cost.ts";

const usage = (cost: number) => ({
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

test("includes assistant, tool, compaction, branch-summary, and standalone usage exactly once", () => {
	const session = SessionManager.inMemory();
	session.appendMessage({
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		usage: usage(1),
		stopReason: "stop",
		timestamp: 1,
	});
	session.appendMessage({
		role: "toolResult",
		toolCallId: "tool",
		toolName: "nested",
		content: [],
		details: {},
		isError: false,
		usage: usage(2),
		timestamp: 2,
	});
	// Use canonical entry types; no branch filtering of cumulative billing.
	const entries = session.getEntries();
	const base = { id: "entry", parentId: null, timestamp: new Date().toISOString() };
	assert.equal(
		totalSessionCost([
			...entries,
			{ ...base, type: "usage", kind: "cache_warm", provider: "openai", model: "test", usage: usage(3) },
			{
				...base,
				type: "compaction",
				summary: "summary",
				firstKeptEntryId: "entry",
				tokensBefore: 1,
				usage: usage(4),
			},
			{ ...base, type: "branch_summary", fromId: "entry", summary: "branch", usage: usage(5) },
			{ ...base, type: "compaction", summary: "legacy", firstKeptEntryId: "entry", tokensBefore: 1 },
		]),
		15,
	);
});

test("UI-owned summary costs are included once, across branches and reloads", () => {
	const session = SessionManager.inMemory();
	session.appendCustomEntry(EXTENSION_USAGE_TYPE, { source: "plan-mode-summary", usage: usage(0.25) });
	session.appendCustomEntry(EXTENSION_USAGE_TYPE, { source: "tool-explain", usage: usage(0.1) });
	session.appendCustomEntry(EXTENSION_USAGE_TYPE, { usage: { cost: { total: "invalid" } } });
	assert.equal(totalSessionCost(session.getEntries()), 0.35);
});

test("cost cache invalidates on appended entries, branch movement, and session replacement", () => {
	const session = SessionManager.inMemory();
	let scans = 0;
	const source = {
		getSessionId: () => session.getSessionId(),
		getLeafId: () => session.getLeafId(),
		getEntries: () => {
			scans++;
			return session.getEntries();
		},
	};
	const read = createSessionCostReader();
	// The reader only requires these public methods.
	assert.equal(read(source), 0);
	assert.equal(read(source), 0);
	assert.equal(scans, 1);
	const leaf = session.appendMessage({
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		usage: usage(7),
		stopReason: "stop",
		timestamp: 1,
	});
	assert.equal(read(source), 7);
	assert.equal(scans, 2);
	session.appendCustomEntry("test", {});
	assert.equal(read(source), 7);
	session.branch(leaf);
	assert.equal(read(source), 7);
	assert.equal(scans, 4);
	assert.equal(read(SessionManager.inMemory()), 0);
});
