/**
 * Typed adapter for the local Rex CLI (API revision 10+).
 *
 * Every call names an explicit session and full block ID; nothing here acts on "the focused pane".
 * Arguments are passed as an array (no shell). Missing CLI, malformed JSON, unsupported servers and
 * ambiguous timeouts surface as RexError so callers can reconcile instead of retrying blindly.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import type { RexPane } from "./store.ts";

export const MIN_API_REVISION = 10;

export type ExecResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean; missing: boolean };
export type Exec = (
	command: string,
	args: readonly string[],
	options: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

export class RexError extends Error {
	readonly kind: "missing" | "unavailable" | "unsupported" | "malformed" | "failed" | "timeout" | "not-found";
	constructor(kind: RexError["kind"], message: string) {
		super(message);
		this.kind = kind;
	}
}

export const defaultExec: Exec = (command, args, options) =>
	new Promise((resolve) => {
		execFile(
			command,
			[...args],
			{ timeout: options.timeoutMs, env: options.env, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
			(error, stdout, stderr) => {
				const failure = error as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
				resolve({
					code: failure ? (typeof failure.code === "number" ? failure.code : null) : 0,
					stdout: String(stdout ?? ""),
					stderr: String(stderr ?? ""),
					timedOut: !!failure?.killed,
					missing: failure?.code === "ENOENT",
				});
			},
		);
	});

export type RexProcess = { pids: number[]; exitCode: number | null | undefined };

function parseJson(text: string, what: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new RexError("malformed", `Rex returned malformed JSON for ${what}.`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new RexError("malformed", `Rex returned an unexpected ${what} response.`);
	return value as Record<string, unknown>;
}

const isId = (value: unknown, prefix: string): value is string =>
	typeof value === "string" && value.startsWith(`${prefix}:`) && value.length > prefix.length + 1;

const notFound = (result: ExecResult) => /not found|not_found|no such/i.test(result.stderr + result.stdout);

export class RexClient {
	private readonly exec: Exec;
	private readonly bin: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly timeoutMs: number;
	private checkedRevision = false;

	constructor(options: { exec?: Exec; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
		this.exec = options.exec ?? defaultExec;
		this.env = options.env ?? process.env;
		this.bin = this.env.REX_BIN_DIR ? join(this.env.REX_BIN_DIR, "rex") : "rex";
		this.timeoutMs = options.timeoutMs ?? 15_000;
	}

	private async run(args: string[], what: string, timeoutMs = this.timeoutMs): Promise<ExecResult> {
		const result = await this.exec(this.bin, args, { timeoutMs, env: this.env });
		if (result.missing) throw new RexError("missing", "The Rex CLI was not found. Side agents require Rex.");
		return result;
	}

	private async json(args: string[], what: string): Promise<Record<string, unknown>> {
		const result = await this.run(args, what);
		if (result.timedOut) throw new RexError("timeout", `Rex timed out during ${what}.`);
		if (result.code !== 0) {
			if (notFound(result)) throw new RexError("not-found", `Rex could not find the target of ${what}.`);
			throw new RexError("failed", `Rex ${what} failed: ${(result.stderr || result.stdout).trim()}`);
		}
		return parseJson(result.stdout, what);
	}

	/** Refuse servers older than the revision whose split/focus/close contracts this adapter uses. */
	async checkCapability(): Promise<void> {
		if (this.checkedRevision) return;
		const version = await this.json(["api", "call", "server.version", "{}"], "version check");
		const revision = version.api_revision;
		if (typeof revision !== "number" || revision < MIN_API_REVISION)
			throw new RexError(
				"unsupported",
				`The Rex server reports API revision ${String(revision)}; side agents need ${MIN_API_REVISION} or newer.`,
			);
		this.checkedRevision = true;
	}

	/**
	 * This process's pane, from REX_SESSION/REX_BLOCK confirmed by `whoami` on the same server.
	 * Never falls back to the focused pane.
	 */
	async self(): Promise<RexPane> {
		const session = this.env.REX_SESSION;
		const block = this.env.REX_BLOCK;
		if (!isId(session, "session") || !isId(block, "block"))
			throw new RexError("unavailable", "Side agents must be opened from Pi running inside a Rex terminal pane.");
		await this.checkCapability();
		const who = await this.json(["whoami", "--json"], "whoami");
		if (
			who.session_id !== session ||
			who.block_id !== block ||
			!isId(who.window_id, "window") ||
			typeof who.instance_id !== "string" ||
			!who.instance_id
		)
			throw new RexError(
				"unavailable",
				"Rex could not confirm this pane (its REX_SESSION/REX_BLOCK are stale or belong to another server).",
			);
		return { serverInstanceId: who.instance_id, sessionId: session, windowId: who.window_id, blockId: block };
	}

	/** The connected server's identity, for checking stored panes against a restarted server. */
	async instanceId(): Promise<string> {
		const who = await this.json(["whoami", "--json"], "whoami");
		if (typeof who.instance_id !== "string" || !who.instance_id)
			throw new RexError("malformed", "Rex whoami did not report a server instance.");
		return who.instance_id;
	}

	/**
	 * Split right of `anchor` and run `command`. Resolves the new full block ID, or `undefined` when
	 * the outcome is ambiguous (timeout, unparseable output): the caller must reconcile by label.
	 */
	async split(options: {
		anchor: RexPane;
		cwd: string;
		label: string;
		command: readonly string[];
		ratio?: number;
		focus?: boolean;
	}): Promise<string | undefined> {
		if (!options.command.length) throw new RexError("failed", "No command to run in the side pane.");
		const result = await this.run(
			[
				"split",
				"-s",
				options.anchor.sessionId,
				"-b",
				options.anchor.blockId,
				"--split=right",
				"--ratio",
				String(options.ratio ?? 50),
				"-c",
				options.cwd,
				"--label",
				options.label,
				`--focus=${options.focus === false ? "false" : "true"}`,
				"--json",
				"--",
				...options.command,
			],
			"split",
			this.timeoutMs + 5_000,
		);
		if (result.timedOut || /timeout|deadline/i.test(result.stderr)) return undefined;
		if (result.code !== 0) {
			if (notFound(result))
				throw new RexError("not-found", "Rex could not find this pane to split; it may have closed.");
			throw new RexError("failed", `Rex split failed: ${(result.stderr || result.stdout).trim()}`);
		}
		let created: Record<string, unknown>;
		try {
			created = parseJson(result.stdout, "split");
		} catch {
			return undefined;
		}
		const block = Array.isArray(created.block_ids) ? created.block_ids[0] : undefined;
		if (!isId(block, "block")) return undefined;
		if (created.anchor_id !== undefined && created.anchor_id !== options.anchor.blockId)
			throw new RexError("malformed", "Rex split a different pane than requested.");
		return block;
	}

	async listBlocks(sessionId: string): Promise<Array<{ blockId: string; label?: string; windowId?: string }>> {
		const listed = await this.json(["block", "ls", "-s", sessionId, "--json"], "block listing");
		if (!Array.isArray(listed.blocks)) throw new RexError("malformed", "Rex returned an unexpected block listing.");
		return listed.blocks.flatMap((block: unknown) => {
			const value = block as Record<string, unknown> | null;
			return value && isId(value.block_id, "block")
				? [
						{
							blockId: value.block_id,
							label: typeof value.label === "string" ? value.label : undefined,
							windowId: typeof value.window_id === "string" ? value.window_id : undefined,
						},
					]
				: [];
		});
	}

	/** Recover the block of a launch whose split call timed out, by its unique label. */
	async findByLabel(sessionId: string, label: string): Promise<string | undefined> {
		const matches = (await this.listBlocks(sessionId)).filter((block) => block.label === label);
		if (matches.length > 1) throw new RexError("failed", `More than one Rex pane is labelled ${label}.`);
		return matches[0]?.blockId;
	}

	/** True/false when Rex answers definitively; throws when it cannot be determined. */
	async exists(pane: RexPane): Promise<boolean> {
		const current = await this.instanceId();
		if (current !== pane.serverInstanceId) return false;
		const result = await this.run(["block", "inspect", "-s", pane.sessionId, pane.blockId, "--json"], "inspect");
		if (result.timedOut) throw new RexError("timeout", "Rex timed out inspecting a pane.");
		if (result.code === 0) {
			const inspected = parseJson(result.stdout, "inspect");
			const block = inspected.block as Record<string, unknown> | undefined;
			return block?.block_id === pane.blockId;
		}
		if (notFound(result)) return false;
		throw new RexError("failed", `Rex inspect failed: ${(result.stderr || result.stdout).trim()}`);
	}

	/** PIDs running in a pane (child, foreground and their ancestors) plus the last exit status. */
	async process(pane: RexPane): Promise<RexProcess | undefined> {
		const result = await this.run(
			["block", "call", "-s", pane.sessionId, "-b", pane.blockId, "process"],
			"process",
		);
		if (result.code !== 0) return undefined;
		let info: Record<string, unknown>;
		try {
			info = parseJson(result.stdout, "process");
		} catch {
			return undefined;
		}
		const pids = new Set<number>();
		const add = (value: unknown) => {
			const pid = (value as { pid?: unknown } | null)?.pid;
			if (typeof pid === "number") pids.add(pid);
		};
		add(info.child);
		add(info.foreground);
		if (Array.isArray(info.ancestors)) info.ancestors.forEach(add);
		const lastExit = info.last_exit as { exit_code?: unknown } | null | undefined;
		return {
			pids: [...pids],
			exitCode:
				lastExit === null ? null : typeof lastExit?.exit_code === "number" ? lastExit.exit_code : undefined,
		};
	}

	/** Whether `pid` runs in `pane`: ownership proof before focusing or closing it. */
	async hosts(pane: RexPane, pid: number): Promise<boolean> {
		if (!(await this.exists(pane))) return false;
		return (await this.process(pane))?.pids.includes(pid) ?? false;
	}

	async focus(pane: RexPane): Promise<void> {
		const result = await this.run(["focus", "-s", pane.sessionId, pane.blockId], "focus");
		if (result.code !== 0) {
			if (notFound(result)) throw new RexError("not-found", "The pane no longer exists.");
			throw new RexError("failed", `Rex focus failed: ${(result.stderr || result.stdout).trim()}`);
		}
	}

	/** Closes exactly one block by full ID. There is deliberately no window/session fallback. */
	async closeBlock(pane: RexPane): Promise<void> {
		if (!isId(pane.blockId, "block")) throw new RexError("failed", "Refusing to close a non-block target.");
		const result = await this.run(["block", "close", "-s", pane.sessionId, pane.blockId], "close");
		if (result.code !== 0 && !notFound(result))
			throw new RexError("failed", `Rex close failed: ${(result.stderr || result.stdout).trim()}`);
	}
}
