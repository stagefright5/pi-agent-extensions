/**
 * Immutable branch capture and child-transcript creation.
 *
 * The parent's live SessionManager is only ever read. A fork copies the selected root-to-boundary
 * path verbatim (IDs, compactions, context edits, system patches, images, labels and extension
 * state), appends provenance and naming entries, and writes a distinct v3 JSONL file. The file is
 * then reopened through SessionManager and its projection compared with the parent's projection
 * at the same boundary before it is accepted.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildSessionProjection,
	CURRENT_SESSION_VERSION,
	SessionManager,
	type SessionEntry,
	type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { SIDE_AGENT_FORK_TYPE, type SideAgentForkData } from "@stagefright5/pi-extension-utils";

/** The read-only parts of a session the capture needs. Never pass a writable manager you own. */
export type SessionSource = {
	getSessionId(): string;
	getSessionFile(): string | undefined;
	getSessionDir(): string;
	getCwd(): string;
	getLeafId(): string | null;
	getBranch(fromId?: string): SessionEntry[];
	getSessionName(): string | undefined;
};

export type BoundaryResult = { ok: true; boundaryId: string; notes: string[] } | { ok: false; reason: string };

type MessageEntry = Extract<SessionEntry, { type: "message" }>;

const isMessage = (entry: SessionEntry | undefined): entry is MessageEntry => entry?.type === "message";
const role = (entry: SessionEntry | undefined) => (isMessage(entry) ? entry.message.role : undefined);

function lastIndex(entries: readonly SessionEntry[], end: number, predicate: (entry: SessionEntry) => boolean) {
	for (let index = end; index >= 0; index--) if (predicate(entries[index])) return index;
	return -1;
}

function toolCallIds(entry: SessionEntry): string[] {
	if (!isMessage(entry) || entry.message.role !== "assistant") return [];
	return entry.message.content.flatMap((part) => (part.type === "toolCall" ? [part.id] : []));
}

/**
 * Remove trailing work that is not a completed exchange: an unanswered user message, or an
 * assistant tool request whose results are not all present. Settled history (including aborted
 * responses whose tool exchanges are closed) is kept exactly as the parent sees it.
 */
function trimIncomplete(branch: readonly SessionEntry[], end: number, notes: string[]): number {
	for (;;) {
		const lastUser = lastIndex(branch, end, (entry) => role(entry) === "user");
		const lastAssistant = lastIndex(branch, end, (entry) => role(entry) === "assistant");
		if (lastUser > lastAssistant) {
			notes.push("Excluded a user message that had not been answered.");
			end = lastUser - 1;
			continue;
		}
		if (lastAssistant >= 0) {
			const calls = toolCallIds(branch[lastAssistant]);
			if (calls.length) {
				const answered = new Set<string>();
				for (let index = lastAssistant + 1; index <= end; index++) {
					const entry = branch[index];
					if (isMessage(entry) && entry.message.role === "toolResult") answered.add(entry.message.toolCallId);
				}
				if (calls.some((id) => !answered.has(id))) {
					notes.push("Excluded a tool exchange that had not completed.");
					end = lastAssistant - 1;
					continue;
				}
			}
		}
		return end;
	}
}

function hasConversation(branch: readonly SessionEntry[], end: number): boolean {
	return (
		lastIndex(
			branch,
			end,
			(entry) =>
				entry.type === "compaction" ||
				entry.type === "branch_summary" ||
				role(entry) === "user" ||
				role(entry) === "assistant",
		) >= 0
	);
}

/**
 * Choose the last fully completed boundary on `branch` (root → leaf).
 *
 * - Idle: the current leaf, minus any structurally incomplete tail (for example after a crash).
 * - Busy: the leaf recorded when the current run started or last completed a response
 *   (`completedLeafId`), so pending input, partial output and open tool exchanges are excluded.
 *   `null` means the run started from an empty session. Without a checkpoint, fall back to the
 *   entry before the latest user message.
 */
export function selectCompletedBoundary(input: {
	branch: readonly SessionEntry[];
	idle: boolean;
	completedLeafId?: string | null;
}): BoundaryResult {
	const { branch } = input;
	if (!branch.length) return { ok: false, reason: "The conversation is empty; there is nothing to fork yet." };
	for (let index = 0; index < branch.length; index++) {
		const expected = index === 0 ? null : branch[index - 1].id;
		if (branch[index].parentId !== expected)
			return {
				ok: false,
				reason: `The active branch has an inconsistent parent reference at entry ${branch[index].id}; refusing to copy it.`,
			};
	}
	const notes: string[] = [];
	let end = branch.length - 1;
	if (!input.idle) {
		if (input.completedLeafId === null)
			return {
				ok: false,
				reason: "The main agent is still working on its first request; no completed turn exists yet.",
			};
		const checkpoint =
			input.completedLeafId === undefined ? -1 : branch.findIndex((entry) => entry.id === input.completedLeafId);
		if (checkpoint >= 0) end = checkpoint;
		else {
			end = lastIndex(branch, end, (entry) => role(entry) === "user") - 1;
			notes.push("Forked before the main agent's current request.");
		}
	}
	end = trimIncomplete(branch, end, notes);
	if (end < 0 || !hasConversation(branch, end))
		return {
			ok: false,
			reason: input.idle
				? "No completed exchange exists yet; send a message first."
				: "The main agent is still working on its first request; no completed turn exists yet.",
		};
	return { ok: true, boundaryId: branch[end].id, notes };
}

export type ForkSnapshot = {
	parentSessionId: string;
	parentSessionFile: string;
	parentSessionDir: string;
	parentSessionName: string | undefined;
	parentLeafId: string | null;
	cwd: string;
	boundaryId: string;
	/** Deep copy of root → boundary; never shared with the live manager. */
	path: SessionEntry[];
	/** Model-visible projection at the boundary, for post-write verification. */
	expected: string;
	projectedModel: { provider: string; modelId: string } | null;
	projectedThinkingLevel: string;
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	notes: string[];
	capturedAt: string;
};

/**
 * Synchronous capture: call it before any asynchronous work so later parent activity cannot move
 * the fork point. Returns a plain-data snapshot.
 */
export function captureFork(
	source: SessionSource,
	options: {
		idle: boolean;
		completedLeafId?: string | null;
		model?: { provider: string; id: string };
		thinkingLevel?: string;
		now?: Date;
	},
): { ok: true; snapshot: ForkSnapshot } | { ok: false; reason: string } {
	const parentSessionFile = source.getSessionFile();
	if (!parentSessionFile)
		return {
			ok: false,
			reason: "This session is not saved (for example `--no-session`). Side agents need a saved parent conversation.",
		};
	const parentLeafId = source.getLeafId();
	const branch = source.getBranch();
	const boundary = selectCompletedBoundary({
		branch,
		idle: options.idle,
		completedLeafId: options.completedLeafId,
	});
	if (!boundary.ok) return boundary;
	if (!existsSync(parentSessionFile))
		return { ok: false, reason: "This conversation has not been written to disk yet; send a message first." };
	const end = branch.findIndex((entry) => entry.id === boundary.boundaryId);
	const path = structuredClone(branch.slice(0, end + 1));
	const projection = buildSessionProjection(path, boundary.boundaryId);
	return {
		ok: true,
		snapshot: {
			parentSessionId: source.getSessionId(),
			parentSessionFile,
			parentSessionDir: source.getSessionDir(),
			parentSessionName: source.getSessionName(),
			parentLeafId,
			cwd: source.getCwd(),
			boundaryId: boundary.boundaryId,
			path,
			expected: JSON.stringify(projection.messages),
			projectedModel: projection.model,
			projectedThinkingLevel: projection.thinkingLevel,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			notes: boundary.notes,
			capturedAt: (options.now ?? new Date()).toISOString(),
		},
	};
}

/** Short title from the parent's name or the first user message on the copied path. */
export function deriveTitle(snapshot: Pick<ForkSnapshot, "parentSessionName" | "path">): string {
	const clean = (text: string) => text.replace(/\s+/g, " ").trim();
	let base = snapshot.parentSessionName ? clean(snapshot.parentSessionName) : "";
	if (!base) {
		for (const entry of snapshot.path) {
			if (!isMessage(entry) || entry.message.role !== "user") continue;
			const content = entry.message.content;
			const text =
				typeof content === "string"
					? content
					: content.map((part) => (part.type === "text" ? part.text : "")).join(" ");
			base = clean(text);
			if (base) break;
		}
	}
	if (!base) base = "conversation";
	return `Side: ${base.length > 60 ? `${base.slice(0, 59)}…` : base}`;
}

export type CreatedChild = {
	childSessionId: string;
	childSessionFile: string;
	provenance: SideAgentForkData;
};

const fileTimestamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-");

/**
 * Write the child transcript and verify it by reopening it. On any failure the new file is removed
 * and the parent is untouched (it is never written).
 */
export function writeChildSession(
	snapshot: ForkSnapshot,
	options: { title: string; now?: Date; childSessionId?: string },
): CreatedChild {
	const now = options.now ?? new Date();
	const childSessionId = options.childSessionId ?? randomUUID();
	const childSessionFile = join(snapshot.parentSessionDir, `${fileTimestamp(now)}_${childSessionId}.jsonl`);
	const used = new Set(snapshot.path.map((entry) => entry.id));
	const newId = () => {
		for (;;) {
			const id = randomBytes(4).toString("hex");
			if (!used.has(id)) {
				used.add(id);
				return id;
			}
		}
	};
	const timestamp = now.toISOString();
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: childSessionId,
		timestamp,
		cwd: snapshot.cwd,
		parentSession: snapshot.parentSessionFile,
	};
	const provenance: SideAgentForkData = {
		version: 1,
		parentSessionId: snapshot.parentSessionId,
		parentSessionFile: snapshot.parentSessionFile,
		parentLeafId: snapshot.parentLeafId,
		boundaryId: snapshot.boundaryId,
		childSessionId,
		createdAt: timestamp,
		title: options.title,
	};
	const appended: SessionEntry[] = [];
	let parentId = snapshot.boundaryId;
	const append = (entry: Record<string, unknown>) => {
		const full = { ...entry, id: newId(), parentId, timestamp } as SessionEntry;
		appended.push(full);
		parentId = full.id;
	};
	append({ type: "custom", customType: SIDE_AGENT_FORK_TYPE, data: provenance });
	append({ type: "session_info", name: options.title });
	// The parent may have switched models after its last recorded change; carry the live selection.
	if (
		snapshot.model &&
		(snapshot.projectedModel?.provider !== snapshot.model.provider ||
			snapshot.projectedModel?.modelId !== snapshot.model.id)
	)
		append({ type: "model_change", provider: snapshot.model.provider, modelId: snapshot.model.id });
	if (snapshot.thinkingLevel && snapshot.thinkingLevel !== snapshot.projectedThinkingLevel)
		append({ type: "thinking_level_change", thinkingLevel: snapshot.thinkingLevel });

	const lines = [header, ...snapshot.path, ...appended].map((entry) => JSON.stringify(entry));
	writeFileSync(childSessionFile, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
	try {
		verifyChildSession(childSessionFile, {
			childSessionId,
			parentSessionFile: snapshot.parentSessionFile,
			pathIds: snapshot.path.map((entry) => entry.id),
			leafId: parentId,
			expected: snapshot.expected,
		});
	} catch (error) {
		rmSync(childSessionFile, { force: true });
		throw error;
	}
	return { childSessionId, childSessionFile, provenance };
}

export function verifyChildSession(
	file: string,
	expected: {
		childSessionId: string;
		parentSessionFile: string;
		pathIds: string[];
		leafId: string;
		expected: string;
	},
): void {
	const manager = SessionManager.open(file);
	const fail = (what: string) => {
		throw new Error(`Side-agent fork verification failed: ${what}.`);
	};
	if (manager.getSessionId() !== expected.childSessionId) fail("session ID differs");
	if (manager.getHeader()?.parentSession !== expected.parentSessionFile) fail("parent session link differs");
	if (manager.getLeafId() !== expected.leafId) fail("leaf differs");
	const branch = manager.getBranch().map((entry) => entry.id);
	if (expected.pathIds.some((id, index) => branch[index] !== id)) fail("copied branch differs");
	if (JSON.stringify(manager.buildSessionProjection().messages) !== expected.expected)
		fail("model-visible context differs from the parent at the fork point");
}
