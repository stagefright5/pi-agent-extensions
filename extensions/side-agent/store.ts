/**
 * Private side-agent linkage, launch ownership, liveness and result inbox.
 *
 * Everything lives under `<agentDir>/side-agent/` (0700 directories, 0600 files, atomic replace).
 * Each document has one writer per phase so processes never run read-modify-write transactions
 * on a shared file:
 *
 * - `children/<child>.json`       parent-owned provenance, written once at fork time
 * - `parents/<parent>.json`       parent-owned managed-pane link
 * - `launch/<child>.lock`         exclusive launch reservation (`wx`), launcher-owned
 * - `live/<child>.json`           child-owned liveness heartbeat; proves which process writes the transcript
 * - `control/<child>.json`        parent-to-child shutdown request, bound to a launch token
 * - `inbox/<parent>/<state>/<id>.json`  results; the child writes `pending/`, the parent renames between states
 */
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonFile, writeJsonFile } from "@stagefright5/pi-extension-utils";

export const STORE_VERSION = 1;
/** Bounded send-back payload, in UTF-8 bytes. */
export const MAX_RESULT_BYTES = 64 * 1024;
/** A live child refreshes its heartbeat at least this often. */
export const HEARTBEAT_MS = 5_000;
const HEARTBEAT_STALE_MS = 6 * HEARTBEAT_MS;

export type RexPane = {
	/** Rex server `instance_id`: block IDs from a restarted server are never trusted. */
	serverInstanceId: string;
	sessionId: string;
	windowId: string;
	blockId: string;
};

export type LaunchConfig = {
	/** Allowlisted Pi options reconstructed from the parent invocation (absolute paths). */
	args: string[];
	/** Allowlisted non-secret Pi process variables. */
	env: Record<string, string>;
	trusted: boolean;
};

export type ToolInventory = {
	/** Tools declared to the model. */
	active: string[];
	/** Active tools plus tools callable through codemode or tool search. */
	callable: string[];
	/** Every configured tool, active or not. */
	configured: string[];
};

export type ChildRecord = {
	version: 1;
	childSessionId: string;
	childSessionFile: string;
	parentSessionId: string;
	parentSessionFile: string;
	parentLeafId: string | null;
	boundaryId: string;
	cwd: string;
	title: string;
	createdAt: string;
	lastOpenedAt?: string;
};

/** Expectations checked by the child once, at its first managed launch. */
export type LaunchExpectation = {
	mode: "fork" | "reopen";
	model?: { provider: string; id: string };
	thinkingLevel?: string;
	tools: ToolInventory;
};

export type LaunchLock = {
	version: 1;
	childSessionId: string;
	parentSessionId: string;
	token: string;
	label: string;
	ownerPid: number;
	createdAt: string;
	parentPane: RexPane;
	parentPid: number;
	expectation: LaunchExpectation;
	childPane?: RexPane;
};

export type LiveState = "starting" | "ready" | "accepted-differences" | "rejected" | "conflict";

export type LiveRecord = {
	version: 1;
	childSessionId: string;
	parentSessionId: string;
	pid: number;
	token?: string;
	rexBlockId?: string;
	rexSessionId?: string;
	/** Launcher pane and PID, kept so /side parent survives /reload after the reservation is released. */
	parentPane?: RexPane;
	parentPid?: number;
	startedAt: string;
	updatedAt: string;
	state: LiveState;
	busy: boolean;
	issues?: string[];
};

export type PaneLink = {
	childSessionId: string;
	token: string;
	label: string;
	pane: RexPane;
	openedAt: string;
};

export type ParentRecord = {
	version: 1;
	parentSessionId: string;
	pane?: PaneLink;
};

export type ControlRequest = {
	version: 1;
	token: string;
	command: "shutdown";
	abort: boolean;
	requestedAt: string;
};

export type InboxState = "pending" | "accepted" | "delivered" | "dismissed" | "rejected";

export type InboxMessage = {
	version: 1;
	messageId: string;
	parentSessionId: string;
	childSessionId: string;
	childSessionFile: string;
	/** Child entry whose assistant text seeded the result. */
	sourceEntryId: string;
	forkBoundaryId: string;
	title: string;
	text: string;
	edited: boolean;
	createdAt: string;
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** IDs become file names. Reject anything that could traverse or collide with temporaries. */
export function assertSafeId(id: string, what = "identifier"): string {
	if (!SAFE_ID.test(id) || id.includes("..")) throw new Error(`Unsafe ${what}: ${JSON.stringify(id)}`);
	return id;
}

/** `kill(pid, 0)`: EPERM still means the process exists. */
export function isPidAlive(pid: number | undefined): boolean {
	if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export type Liveness = "running" | "unknown" | "dead";

/** A heartbeat older than the stale window or a recycled PID cannot prove a running child. */
export function liveness(record: LiveRecord | undefined, now = Date.now(), alive = isPidAlive): Liveness {
	if (!record) return "dead";
	if (!alive(record.pid)) return "dead";
	const age = now - Date.parse(record.updatedAt);
	return Number.isFinite(age) && age <= HEARTBEAT_STALE_MS ? "running" : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unreadable or foreign-version documents are treated as absent for reads, never overwritten blindly. */
function readVersioned<T>(path: string, check: (value: Record<string, unknown>) => boolean): T | undefined {
	let value: unknown;
	try {
		value = readJsonFile(path);
	} catch {
		return undefined;
	}
	return isRecord(value) && value.version === STORE_VERSION && check(value) ? (value as T) : undefined;
}

const str = (value: unknown) => typeof value === "string" && value.length > 0;

export class SideAgentStore {
	readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	private dir(...parts: string[]): string {
		const path = join(this.root, ...parts);
		mkdirSync(path, { recursive: true, mode: 0o700 });
		return path;
	}

	// Child provenance -------------------------------------------------------------------------

	writeChild(record: ChildRecord): void {
		writeJsonFile(join(this.dir("children"), `${assertSafeId(record.childSessionId)}.json`), record);
	}

	readChild(childSessionId: string): ChildRecord | undefined {
		return readVersioned<ChildRecord>(
			join(this.root, "children", `${assertSafeId(childSessionId)}.json`),
			(v) => str(v.childSessionId) && str(v.parentSessionId) && str(v.childSessionFile),
		);
	}

	/** Children recorded for exactly this parent session ID, newest first. */
	listChildren(parentSessionId: string): ChildRecord[] {
		let names: string[];
		try {
			names = readdirSync(join(this.root, "children"));
		} catch {
			return [];
		}
		return names
			.filter((name) => name.endsWith(".json"))
			.map((name) => {
				try {
					return this.readChild(name.slice(0, -5));
				} catch {
					return undefined;
				}
			})
			.filter((record): record is ChildRecord => record?.parentSessionId === parentSessionId)
			.sort((a, b) => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt));
	}

	// Parent pane link -------------------------------------------------------------------------

	readParent(parentSessionId: string): ParentRecord {
		return (
			readVersioned<ParentRecord>(
				join(this.root, "parents", `${assertSafeId(parentSessionId)}.json`),
				(v) => v.parentSessionId === parentSessionId,
			) ?? { version: 1, parentSessionId }
		);
	}

	writeParent(record: ParentRecord): void {
		writeJsonFile(join(this.dir("parents"), `${assertSafeId(record.parentSessionId)}.json`), record);
	}

	setPane(parentSessionId: string, pane: PaneLink | undefined): void {
		const record = this.readParent(parentSessionId);
		this.writeParent({ ...record, pane });
	}

	// Launch reservation -----------------------------------------------------------------------

	private lockPath(childSessionId: string): string {
		return join(this.dir("launch"), `${assertSafeId(childSessionId)}.lock`);
	}

	/** Exclusive creation: exactly one process may reserve a launch of one child transcript. */
	acquireLaunch(lock: LaunchLock): boolean {
		try {
			writeFileSync(this.lockPath(lock.childSessionId), JSON.stringify(lock, null, 2) + "\n", {
				flag: "wx",
				mode: 0o600,
			});
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
			throw error;
		}
	}

	readLaunch(childSessionId: string): LaunchLock | undefined {
		return readVersioned<LaunchLock>(
			this.lockPath(childSessionId),
			(v) => v.childSessionId === childSessionId && str(v.token),
		);
	}

	/** Only the reservation's owner (by token) may amend it. */
	updateLaunch(lock: LaunchLock): boolean {
		if (this.readLaunch(lock.childSessionId)?.token !== lock.token) return false;
		writeJsonFile(this.lockPath(lock.childSessionId), lock);
		return true;
	}

	releaseLaunch(childSessionId: string, token: string | undefined): void {
		const current = this.readLaunch(childSessionId);
		// A malformed reservation is released by whoever reconciles it; a foreign token never is.
		if (current && token !== undefined && current.token !== token) return;
		rmSync(this.lockPath(childSessionId), { force: true });
	}

	// Child liveness ---------------------------------------------------------------------------

	private livePath(childSessionId: string): string {
		return join(this.dir("live"), `${assertSafeId(childSessionId)}.json`);
	}

	readLive(childSessionId: string): LiveRecord | undefined {
		return readVersioned<LiveRecord>(
			this.livePath(childSessionId),
			(v) => v.childSessionId === childSessionId && typeof v.pid === "number",
		);
	}

	writeLive(record: LiveRecord): void {
		writeJsonFile(this.livePath(record.childSessionId), record);
	}

	/** Remove a heartbeat only if this process wrote it. */
	removeLive(childSessionId: string, pid: number): void {
		const current = this.readLive(childSessionId);
		if (current && current.pid !== pid) return;
		rmSync(this.livePath(childSessionId), { force: true });
	}

	// Control requests -------------------------------------------------------------------------

	private controlPath(childSessionId: string): string {
		return join(this.dir("control"), `${assertSafeId(childSessionId)}.json`);
	}

	requestControl(childSessionId: string, request: ControlRequest): void {
		writeJsonFile(this.controlPath(childSessionId), request);
	}

	takeControl(childSessionId: string, token: string | undefined): ControlRequest | undefined {
		const request = readVersioned<ControlRequest>(
			this.controlPath(childSessionId),
			(v) => str(v.token) && v.command === "shutdown",
		);
		if (!request) return undefined;
		rmSync(this.controlPath(childSessionId), { force: true });
		return token !== undefined && request.token === token ? request : undefined;
	}

	clearControl(childSessionId: string): void {
		rmSync(this.controlPath(childSessionId), { force: true });
	}

	// Result inbox -----------------------------------------------------------------------------

	private inboxPath(parentSessionId: string, state: InboxState, messageId?: string): string {
		const dir = this.dir("inbox", assertSafeId(parentSessionId), state);
		return messageId === undefined ? dir : join(dir, `${assertSafeId(messageId, "message ID")}.json`);
	}

	/** The child's only write into parent-owned state: an atomic, uniquely named pending file. */
	postResult(message: InboxMessage): void {
		const bytes = Buffer.byteLength(message.text, "utf8");
		if (bytes > MAX_RESULT_BYTES)
			throw new Error(`Result is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_RESULT_BYTES / 1024} KB.`);
		if (!message.text.trim()) throw new Error("Result is empty.");
		writeJsonFile(this.inboxPath(message.parentSessionId, "pending", message.messageId), message);
	}

	listInbox(parentSessionId: string, state: InboxState): InboxMessage[] {
		let names: string[];
		const dir = this.inboxPath(parentSessionId, state);
		try {
			names = readdirSync(dir);
		} catch {
			return [];
		}
		const messages: InboxMessage[] = [];
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const message = readVersioned<InboxMessage>(
				join(dir, name),
				(v) => str(v.messageId) && typeof v.text === "string" && str(v.childSessionId),
			);
			// Name and content must agree, or a crafted file could claim another message's identity.
			if (message && `${message.messageId}.json` === name) messages.push(message);
		}
		return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	/** Atomic state transition. False when another actor already moved (or removed) the message. */
	moveInbox(parentSessionId: string, messageId: string, from: InboxState, to: InboxState): boolean {
		try {
			renameSync(
				this.inboxPath(parentSessionId, from, messageId),
				this.inboxPath(parentSessionId, to, messageId),
			);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}
}
