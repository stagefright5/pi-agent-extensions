import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { SIDE_AGENT_FORK_TYPE } from "@stagefright5/pi-extension-utils";
import { captureFork, deriveTitle, selectCompletedBoundary, writeChildSession } from "./fork.ts";

const usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
let clock = 1_700_000_000_000;
const user = (content: unknown) => ({ role: "user", content, timestamp: clock++ }) as never;
const assistant = (text: string, extra: Record<string, unknown> = {}) =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "model-a",
		usage,
		stopReason: "stop",
		timestamp: clock++,
		...extra,
	}) as never;
const toolCall = (id: string) =>
	assistant("", {
		content: [{ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }],
		stopReason: "toolUse",
	});
const toolResult = (id: string) =>
	({
		role: "toolResult",
		toolCallId: id,
		toolName: "bash",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp: clock++,
	}) as never;
const system = (sections: Record<string, string | null>) =>
	({ role: "system", content: "", sections, timestamp: clock++ }) as never;

function fixture(t: test.TestContext) {
	const root = mkdtempSync(join(tmpdir(), "side-fork-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const manager = SessionManager.create(root, join(root, "sessions"));
	return { root, manager };
}

const capture = (manager: SessionManager, options: Parameters<typeof captureFork>[1] = { idle: true }) => {
	const result = captureFork(manager, options);
	assert.ok(result.ok, result.ok ? "" : result.reason);
	return result.snapshot;
};

const childBranch = (file: string) => SessionManager.open(file).getBranch();
const projection = (manager: SessionManager, leafId?: string) => {
	if (leafId) {
		const copy = SessionManager.open(manager.getSessionFile()!);
		copy.branch(leafId);
		return JSON.stringify(copy.buildSessionProjection().messages);
	}
	return JSON.stringify(manager.buildSessionProjection().messages);
};

test("linear idle fork copies the whole branch into a distinct verified session and leaves the parent untouched", (t) => {
	const { manager } = fixture(t);
	manager.appendModelChange("anthropic", "model-a");
	manager.appendThinkingLevelChange("high");
	manager.appendMessage(system({ preamble: "You are Pi", tools: "<tools/>" }));
	manager.appendMessage(user("Investigate the bug"));
	manager.appendMessage(assistant("It is in parser.ts"));
	const parentFile = manager.getSessionFile()!;
	const before = readFileSync(parentFile, "utf8");
	const leaf = manager.getLeafId();
	const snapshot = capture(manager, {
		idle: true,
		model: { provider: "anthropic", id: "model-a" },
		thinkingLevel: "high",
	});
	assert.equal(snapshot.boundaryId, leaf);
	const created = writeChildSession(snapshot, { title: deriveTitle(snapshot) });

	assert.notEqual(created.childSessionId, manager.getSessionId());
	assert.equal(readFileSync(parentFile, "utf8"), before, "parent transcript bytes are unchanged");
	assert.equal(manager.getLeafId(), leaf, "parent leaf is unchanged");
	const child = SessionManager.open(created.childSessionFile);
	assert.equal(child.getHeader()?.parentSession, parentFile);
	assert.equal(child.getSessionName(), "Side: Investigate the bug");
	assert.equal(JSON.stringify(child.buildSessionProjection().messages), projection(manager));
	const branch = child.getBranch();
	const marker = branch.find((entry) => entry.type === "custom" && entry.customType === SIDE_AGENT_FORK_TYPE);
	assert.ok(marker && marker.type === "custom");
	assert.deepEqual((marker.data as { boundaryId: string }).boundaryId, leaf);
	// Model and thinking already match the copied branch: no redundant change entries.
	assert.equal(branch.filter((entry) => entry.type === "model_change").length, 1);
	if (process.platform !== "win32") assert.equal(statSync(created.childSessionFile).mode & 0o777, 0o600);
});

test("historical active branch: abandoned siblings are not copied", (t) => {
	const { manager } = fixture(t);
	manager.appendMessage(user("A"));
	const a = manager.appendMessage(assistant("a"));
	manager.appendMessage(user("abandoned"));
	manager.appendMessage(assistant("abandoned answer"));
	manager.branch(a);
	manager.appendMessage(user("B"));
	const leaf = manager.appendMessage(assistant("b"));
	const snapshot = capture(manager);
	const created = writeChildSession(snapshot, { title: "Side: test" });
	const texts = JSON.stringify(childBranch(created.childSessionFile));
	assert.ok(!texts.includes("abandoned"));
	assert.equal(snapshot.boundaryId, leaf);
	assert.equal(
		JSON.stringify(SessionManager.open(created.childSessionFile).buildSessionProjection().messages),
		projection(manager),
	);
});

test("compaction, context edits, system patches, images and labels are preserved, not flattened", (t) => {
	const { manager } = fixture(t);
	manager.appendMessage(system({ preamble: "You are Pi" }));
	manager.appendMessage(user("old request"));
	const kept = manager.appendMessage(assistant("old answer"));
	manager.appendMessage(
		user([
			{ type: "text", text: "see image" },
			{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
		]),
	);
	const edited = manager.appendMessage(assistant("secret token 123"));
	manager.appendCompaction("Summary of the old request", kept, 1234);
	manager.appendContextEdit(edited, { content: [{ type: "text", text: "[redacted]" }] });
	manager.appendMessage(system({ skills: "<skills/>" }));
	manager.appendLabelChange(kept, "checkpoint");
	manager.appendCustomEntry("plan-mode-interactive", { version: 2, active: true });
	manager.appendMessage(user("next"));
	manager.appendMessage(assistant("done"));
	const snapshot = capture(manager);
	const created = writeChildSession(snapshot, { title: "Side: x" });
	const child = SessionManager.open(created.childSessionFile);
	const childMessages = JSON.stringify(child.buildSessionProjection().messages);
	assert.equal(childMessages, projection(manager));
	assert.ok(childMessages.includes("Summary of the old request"));
	assert.ok(childMessages.includes("[redacted]") && !childMessages.includes("secret token 123"));
	assert.ok(childMessages.includes("aGVsbG8="));
	const types = new Set(child.getBranch().map((entry) => entry.type));
	for (const type of ["compaction", "context_edit", "label", "custom"]) assert.ok(types.has(type as never), type);
	assert.equal(child.getLabel(kept), "checkpoint");
});

test("busy parent: fork at the checkpoint, excluding pending input, partial work and later events", (t) => {
	const { manager } = fixture(t);
	manager.appendMessage(user("first"));
	const checkpoint = manager.appendMessage(assistant("first answer"));
	// The current run: its input and an unfinished tool exchange.
	manager.appendMessage(user("long task"));
	manager.appendMessage(toolCall("call-1"));
	const snapshot = capture(manager, { idle: false, completedLeafId: checkpoint });
	assert.equal(snapshot.boundaryId, checkpoint);
	assert.equal(snapshot.parentLeafId, manager.getLeafId());
	// Later parent activity cannot move a captured fork point.
	manager.appendMessage(toolResult("call-1"));
	manager.appendMessage(assistant("finished"));
	const created = writeChildSession(snapshot, { title: "Side: busy" });
	const text = JSON.stringify(childBranch(created.childSessionFile));
	assert.ok(!text.includes("long task") && !text.includes("finished") && !text.includes("call-1"));
	assert.equal(
		JSON.stringify(SessionManager.open(created.childSessionFile).buildSessionProjection().messages),
		projection(manager, checkpoint),
	);
});

test("busy without a checkpoint falls back to before the latest request; a first request has no boundary", (t) => {
	const { manager } = fixture(t);
	manager.appendMessage(user("first"));
	const answer = manager.appendMessage(assistant("answer"));
	manager.appendMessage(user("current"));
	const fallback = captureFork(manager, { idle: false });
	assert.ok(fallback.ok);
	assert.equal(fallback.snapshot.boundaryId, answer);
	assert.match(fallback.snapshot.notes.join(" "), /before the main agent's current request/);
	const first = captureFork(manager, { idle: false, completedLeafId: null });
	assert.equal(first.ok, false);
	assert.match(first.ok ? "" : first.reason, /first request/);
});

test("outstanding tool calls and unanswered input are trimmed; aborted but closed history is kept", (t) => {
	const { manager } = fixture(t);
	manager.appendMessage(user("one"));
	const a1 = manager.appendMessage(assistant("one done"));
	manager.appendMessage(user("two"));
	manager.appendMessage(toolCall("orphan"));
	const trimmed = capture(manager);
	assert.equal(trimmed.boundaryId, a1);
	assert.equal(trimmed.notes.length, 2);

	const aborted = fixture(t).manager;
	aborted.appendMessage(user("one"));
	aborted.appendMessage(assistant("partial", { stopReason: "aborted" }));
	const leaf = aborted.getLeafId();
	assert.equal(capture(aborted).boundaryId, leaf);

	const closedTools = fixture(t).manager;
	closedTools.appendMessage(user("run it"));
	closedTools.appendMessage(toolCall("c1"));
	const result = closedTools.appendMessage(toolResult("c1"));
	assert.equal(capture(closedTools).boundaryId, result, "settled, closed tool exchange is history");
});

test("absent or unpersisted context is explained rather than copied", (t) => {
	const { manager } = fixture(t);
	manager.appendModelChange("anthropic", "model-a");
	const empty = captureFork(manager, { idle: true });
	assert.equal(empty.ok, false);
	const memory = SessionManager.inMemory("/tmp");
	memory.appendMessage(user("hi"));
	memory.appendMessage(assistant("hello"));
	const unsaved = captureFork(memory, { idle: true });
	assert.equal(unsaved.ok, false);
	assert.match(unsaved.ok ? "" : unsaved.reason, /not saved/);
	assert.equal(selectCompletedBoundary({ branch: [], idle: true }).ok, false);
	const broken = [
		{ type: "message", id: "a", parentId: null, timestamp: "", message: user("x") },
		{ type: "message", id: "b", parentId: "zzz", timestamp: "", message: assistant("y") },
	] as SessionEntry[];
	const result = selectCompletedBoundary({ branch: broken, idle: true });
	assert.equal(result.ok, false);
	assert.match(result.ok ? "" : result.reason, /inconsistent parent/);
});

test("live model and thinking selections are recorded when they differ from the branch", (t) => {
	const { manager } = fixture(t);
	manager.appendModelChange("anthropic", "model-a");
	manager.appendThinkingLevelChange("low");
	manager.appendMessage(user("q"));
	manager.appendMessage(assistant("a"));
	const snapshot = capture(manager, {
		idle: true,
		model: { provider: "openai", id: "model-b" },
		thinkingLevel: "high",
	});
	const created = writeChildSession(snapshot, { title: "Side: m" });
	const context = SessionManager.open(created.childSessionFile).buildSessionContext();
	assert.deepEqual(context.model, { provider: "openai", modelId: "model-b" });
	assert.equal(context.thinkingLevel, "high");
});

test("a fork whose reopened context differs is rejected and removed", (t) => {
	const { manager, root } = fixture(t);
	manager.appendMessage(user("q"));
	manager.appendMessage(assistant("a"));
	const snapshot = capture(manager);
	const before = readdirSync(join(root, "sessions")).length;
	assert.throws(
		() => writeChildSession({ ...snapshot, expected: "[]" }, { title: "Side: bad" }),
		/model-visible context differs/,
	);
	assert.equal(readdirSync(join(root, "sessions")).length, before);
	const created = writeChildSession(snapshot, { title: "Side: ok", childSessionId: "fixed-id" });
	assert.ok(existsSync(created.childSessionFile));
	writeChildSession(snapshot, { title: "Side: dup", childSessionId: "dup-id", now: new Date(0) });
	assert.throws(
		() => writeChildSession(snapshot, { title: "Side: dup", childSessionId: "dup-id", now: new Date(0) }),
		/EEXIST/,
		"an existing transcript is never overwritten",
	);
});
