import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	assertSafeId,
	liveness,
	MAX_RESULT_BYTES,
	SideAgentStore,
	type InboxMessage,
	type LaunchLock,
	type LiveRecord,
} from "./store.ts";

function fixture(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "side-store-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new SideAgentStore(join(root, "side-agent")) };
}

const pane = { serverInstanceId: "srv", sessionId: "session:s", windowId: "window:w", blockId: "block:parent" };
const lock = (token: string): LaunchLock => ({
	version: 1,
	childSessionId: "child-1",
	parentSessionId: "parent-1",
	token,
	label: `pi-side-${token}`,
	ownerPid: process.pid,
	createdAt: new Date().toISOString(),
	parentPane: pane,
	parentPid: process.pid,
	expectation: { mode: "fork", tools: { active: [], callable: [], configured: [] } },
});
const message = (id: string, extra: Partial<InboxMessage> = {}): InboxMessage => ({
	version: 1,
	messageId: id,
	parentSessionId: "parent-1",
	childSessionId: "child-1",
	childSessionFile: "/tmp/child.jsonl",
	sourceEntryId: "e1",
	forkBoundaryId: "b1",
	title: "Side: x",
	text: "result",
	edited: false,
	createdAt: new Date().toISOString(),
	...extra,
});

test("launch reservations are exclusive and only their owner token can amend or release them", (t) => {
	const { store, root } = fixture(t);
	assert.equal(store.acquireLaunch(lock("a")), true);
	assert.equal(store.acquireLaunch(lock("b")), false, "a second launcher cannot reserve the same child");
	assert.equal(store.updateLaunch({ ...lock("b"), label: "hijack" }), false);
	store.releaseLaunch("child-1", "b");
	assert.equal(store.readLaunch("child-1")?.token, "a", "a foreign token never releases a reservation");
	assert.equal(store.updateLaunch({ ...lock("a"), childPane: { ...pane, blockId: "block:child" } }), true);
	assert.equal(store.readLaunch("child-1")?.childPane?.blockId, "block:child");
	store.releaseLaunch("child-1", "a");
	assert.equal(store.readLaunch("child-1"), undefined);
	if (process.platform !== "win32") {
		assert.equal(statSync(join(root, "side-agent")).mode & 0o777, 0o700);
		store.acquireLaunch(lock("c"));
		assert.equal(statSync(join(root, "side-agent", "launch", "child-1.lock")).mode & 0o777, 0o600);
	}
});

test("liveness needs both a live PID and a fresh heartbeat", () => {
	const record: LiveRecord = {
		version: 1,
		childSessionId: "c",
		parentSessionId: "p",
		pid: 4242,
		startedAt: "",
		updatedAt: new Date().toISOString(),
		state: "ready",
		busy: false,
	};
	assert.equal(liveness(undefined), "dead");
	assert.equal(
		liveness(record, Date.now(), () => false),
		"dead",
	);
	assert.equal(
		liveness(record, Date.now(), () => true),
		"running",
	);
	assert.equal(
		liveness(record, Date.now() + 10 * 60_000, () => true),
		"unknown",
		"recycled PID or hung child",
	);
});

test("heartbeats are removed only by the process that wrote them", (t) => {
	const { store } = fixture(t);
	const record: LiveRecord = {
		version: 1,
		childSessionId: "child-1",
		parentSessionId: "p",
		pid: 111,
		startedAt: "",
		updatedAt: new Date().toISOString(),
		state: "ready",
		busy: false,
	};
	store.writeLive(record);
	store.removeLive("child-1", 222);
	assert.equal(store.readLive("child-1")?.pid, 111);
	store.removeLive("child-1", 111);
	assert.equal(store.readLive("child-1"), undefined);
});

test("control requests are consumed once and honoured only with the matching launch token", (t) => {
	const { store } = fixture(t);
	const request = { version: 1 as const, token: "tok", command: "shutdown" as const, abort: true, requestedAt: "" };
	store.requestControl("child-1", request);
	assert.equal(store.takeControl("child-1", "other"), undefined);
	assert.equal(store.takeControl("child-1", "tok"), undefined, "a mismatched read still consumes the request");
	store.requestControl("child-1", request);
	assert.deepEqual(store.takeControl("child-1", "tok"), request);
	assert.equal(store.takeControl("child-1", "tok"), undefined);
});

test("inbox transitions are atomic, bounded and reject renamed or oversized results", (t) => {
	const { store, root } = fixture(t);
	store.postResult(message("m1"));
	assert.deepEqual(
		store.listInbox("parent-1", "pending").map((m) => m.messageId),
		["m1"],
	);
	assert.equal(store.moveInbox("parent-1", "m1", "pending", "accepted"), true);
	assert.equal(store.moveInbox("parent-1", "m1", "pending", "accepted"), false, "second transition loses");
	assert.equal(store.listInbox("parent-1", "pending").length, 0);
	assert.throws(() => store.postResult(message("big", { text: "x".repeat(MAX_RESULT_BYTES + 1) })), /limit/);
	assert.throws(() => store.postResult(message("empty", { text: "  " })), /empty/);
	// A file whose name disagrees with its content cannot impersonate another message.
	const pending = join(root, "side-agent", "inbox", "parent-1", "pending");
	writeFileSync(join(pending, "m9.json"), JSON.stringify(message("m1")));
	writeFileSync(join(pending, "junk.json"), "{broken");
	assert.deepEqual(store.listInbox("parent-1", "pending"), []);
	assert.ok(readdirSync(pending).includes("junk.json"), "unreadable files are left in place, never overwritten");
});

test("children are keyed by session IDs and listed per parent, newest first", (t) => {
	const { store } = fixture(t);
	const base = {
		version: 1 as const,
		childSessionFile: "/tmp/c.jsonl",
		parentSessionFile: "/tmp/p.jsonl",
		parentLeafId: null,
		boundaryId: "b",
		cwd: "/tmp",
		title: "Side",
	};
	store.writeChild({ ...base, childSessionId: "c1", parentSessionId: "p1", createdAt: "2026-01-01T00:00:00Z" });
	store.writeChild({ ...base, childSessionId: "c2", parentSessionId: "p1", createdAt: "2026-01-02T00:00:00Z" });
	store.writeChild({ ...base, childSessionId: "c3", parentSessionId: "p2", createdAt: "2026-01-03T00:00:00Z" });
	assert.deepEqual(
		store.listChildren("p1").map((c) => c.childSessionId),
		["c2", "c1"],
	);
	assert.throws(() => assertSafeId("../escape"));
	assert.throws(() => store.readChild("a/b"));
	store.setPane("p1", { childSessionId: "c1", token: "t", label: "l", pane, openedAt: "" });
	assert.equal(store.readParent("p1").pane?.childSessionId, "c1");
	store.setPane("p1", undefined);
	assert.equal(store.readParent("p1").pane, undefined);
});
