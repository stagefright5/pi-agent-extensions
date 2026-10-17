/**
 * Shell jobs that can outlive the tool call that started them.
 *
 * A job runs in its own process group. While its tool call waits in the foreground, output stays in
 * memory (no file for the common quick command). Once the job moves to the background, the buffered
 * output is flushed to a log file and later output streams there. A small tail ring serves previews
 * and notifications without reading the file.
 *
 * Change events are deliberately coarse: `state` fires on start, backgrounding, exit, and read-state
 * changes; `output` fires at most every OUTPUT_EVENT_MS per manager, never per chunk.
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
	createReadStream,
	createWriteStream,
	mkdirSync,
	mkdtempSync,
	chmodSync,
	lstatSync,
	type WriteStream,
} from "node:fs";
import { open, rm } from "node:fs/promises";
import { constants as osConstants, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export type JobState = "running" | "exited" | "killed" | "timed-out";
export type JobChange = "state" | "output";

export interface ShellConfig {
	shell: string;
	args: string[];
	commandTransport?: "argv" | "stdin";
}

export interface StartOptions {
	command: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	/** Seconds until the job is killed, measured from its start (foreground or background). */
	timeout?: number;
	shell: ShellConfig;
}

/** Output kept in memory for previews and notifications. */
export const TAIL_BYTES = 64 * 1024;
/** Foreground output buffered until the job is backgrounded (beyond this, the oldest is dropped). */
export const FOREGROUND_BUFFER_BYTES = 16 * 1024 * 1024;
/** Output events are coalesced to this interval across all jobs. */
export const OUTPUT_EVENT_MS = 250;
/** Grace between SIGTERM and SIGKILL. */
export const KILL_GRACE_MS = 3000;
/** After the shell exits, wait this long for inherited pipes to go quiet before reporting the exit. */
const EXIT_IDLE_MS = 100;

/** Byte-capped ring of raw chunks; decoded only when read. */
export class TailRing {
	private chunks: Buffer[] = [];
	private size = 0;
	/** Whether the kept bytes start at a line boundary (always, until something was dropped). */
	private startsAtLine = true;
	private readonly cap: number;

	constructor(cap: number) {
		this.cap = cap;
	}

	push(chunk: Buffer): void {
		this.chunks.push(chunk);
		this.size += chunk.length;
		while (this.size > this.cap && this.chunks.length > 1) {
			const dropped = this.chunks.shift()!;
			this.size -= dropped.length;
			this.startsAtLine = dropped[dropped.length - 1] === 0x0a;
		}
		if (this.size > this.cap) {
			const only = this.chunks[0]!;
			const cut = only.length - this.cap;
			this.chunks[0] = only.subarray(cut);
			this.size = this.cap;
			this.startsAtLine = only[cut - 1] === 0x0a;
		}
	}

	/** Decoded tail. When older output was dropped mid-line, that partial first line is dropped too. */
	text(): string {
		const text = Buffer.concat(this.chunks, this.size).toString("utf8");
		if (this.startsAtLine) return text;
		const newline = text.indexOf("\n");
		return newline < 0 ? text : text.slice(newline + 1);
	}

	get bytes(): number {
		return this.size;
	}
}

// Matching control characters is the point of these patterns.
// oxlint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/gu;
// oxlint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f\ufff9-\ufffb]/gu;

/** Remove terminal escape sequences and control characters that break width measurement. */
export function cleanOutput(text: string): string {
	return text
		.replace(ESCAPES, "")
		.replace(/\r\n/gu, "\n")
		.replace(/[^\n]*\r(?!\n)/gu, "")
		.replace(CONTROLS, "");
}

/** Ignore one trailing newline when counting lines. */
export function lastLines(text: string, lines: number): string {
	const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
	if (lines <= 0) return "";
	let at = trimmed.length;
	for (let count = 0; count < lines; count++) {
		at = trimmed.lastIndexOf("\n", at - 1);
		if (at < 0) return trimmed;
	}
	return trimmed.slice(at + 1);
}

export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

export type ForegroundOutcome = "exit" | "background" | "abort";

export class Job {
	/** Internal sequence; `id` is assigned only when the job moves to the background. */
	readonly seq: number;
	id = "";
	readonly command: string;
	readonly cwd: string;
	readonly startedAt = Date.now();
	readonly timeout: number | undefined;
	pid: number | undefined;
	state: JobState = "running";
	exitCode: number | null = null;
	signal: string | null = null;
	endedAt: number | undefined;
	backgrounded = false;
	backgroundedAt: number | undefined;
	/** A backgrounded job finished and nobody (agent or user) has looked at the result yet. */
	unread = false;
	/** The agent has read the finished result (suppresses the finish notification). */
	agentSeen = false;
	/** The finish notification was sent. */
	notified = false;
	/** Stopped on purpose with `kill()` (never unread). */
	killedByUser = false;
	/** Who stopped it: the agent already knows (no message); a user stop is reported to the agent. */
	stoppedBy: "user" | "agent" | undefined;
	logPath: string | undefined;
	outputBytes = 0;
	/** Bumped (throttled) when output arrives; previews key their caches on it. */
	outputVersion = 0;
	/** Bumped on every state change. */
	stateVersion = 0;

	private readonly tail = new TailRing(TAIL_BYTES);
	private foreground: Buffer[] | undefined = [];
	private foregroundBytes = 0;
	private foregroundDropped = false;
	private log: WriteStream | undefined;
	private readonly listeners = new Set<(chunk: Buffer) => void>();
	private readonly exitWaiters = new Set<() => void>();
	private child: ChildProcess | undefined;
	private timeoutTimer: NodeJS.Timeout | undefined;
	private killTimer: NodeJS.Timeout | undefined;
	private timedOut = false;
	private streamsOpen = 0;
	private readonly manager: JobManager;

	constructor(manager: JobManager, seq: number, options: StartOptions) {
		this.manager = manager;
		this.seq = seq;
		this.command = options.command;
		this.cwd = options.cwd;
		this.timeout = options.timeout;
	}

	/** @internal */
	spawn(options: StartOptions): void {
		const { shell } = options;
		const viaStdin = shell.commandTransport === "stdin";
		let child: ChildProcess;
		try {
			child = spawn(shell.shell, viaStdin ? shell.args : [...shell.args, options.command], {
				cwd: options.cwd,
				env: options.env,
				detached: process.platform !== "win32",
				stdio: [viaStdin ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
		} catch (error) {
			this.fail(error);
			return;
		}
		this.child = child;
		this.pid = child.pid;
		if (viaStdin) {
			child.stdin?.on("error", () => {});
			child.stdin?.end(options.command);
		}
		const onData = (chunk: Buffer) => this.append(chunk);
		for (const stream of [child.stdout, child.stderr]) {
			if (!stream) continue;
			this.streamsOpen++;
			stream.on("data", onData);
			stream.once("close", () => {
				this.streamsOpen = Math.max(0, this.streamsOpen - 1);
				if (this.streamsOpen === 0) this.closeLog();
				if (this.exitPending) this.finishSoon();
			});
		}
		child.once("error", (error) => this.fail(error));
		child.once("exit", (code, signal) => {
			this.exitPending = { code, signal };
			this.finishSoon();
		});
		if (options.timeout !== undefined) {
			this.timeoutTimer = setTimeout(() => {
				this.timedOut = true;
				this.terminate();
			}, options.timeout * 1000);
			this.timeoutTimer.unref();
		}
	}

	private exitPending: { code: number | null; signal: NodeJS.Signals | null } | undefined;
	private idleTimer: NodeJS.Timeout | undefined;

	/** Report the exit once pipes close, or after they stay quiet briefly (descendants may hold them). */
	private finishSoon(): void {
		if (this.state !== "running" || !this.exitPending) return;
		if (this.streamsOpen === 0) return this.finish();
		clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => this.finish(), EXIT_IDLE_MS);
	}

	private append(chunk: Buffer): void {
		this.outputBytes += chunk.length;
		this.tail.push(chunk);
		if (this.foreground) {
			this.foreground.push(chunk);
			this.foregroundBytes += chunk.length;
			while (this.foregroundBytes > FOREGROUND_BUFFER_BYTES && this.foreground.length > 1) {
				this.foregroundBytes -= this.foreground.shift()!.length;
				this.foregroundDropped = true;
			}
		} else {
			this.log?.write(chunk);
		}
		for (const listener of this.listeners) listener(chunk);
		if (this.exitPending) this.finishSoon();
		this.manager.outputChanged(this);
	}

	private fail(error: unknown): void {
		const message = `${error instanceof Error ? error.message : String(error)}\n`;
		this.append(Buffer.from(message));
		this.exitPending = { code: 127, signal: null };
		this.streamsOpen = 0;
		this.finish();
	}

	private finish(): void {
		if (this.state !== "running") return;
		clearTimeout(this.idleTimer);
		clearTimeout(this.timeoutTimer);
		const { code, signal } = this.exitPending ?? { code: null, signal: null };
		this.signal = signal;
		this.exitCode = code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1);
		this.endedAt = Date.now();
		this.state = this.timedOut ? "timed-out" : this.killedByUser ? "killed" : "exited";
		this.unread = this.backgrounded && !this.killedByUser;
		if (this.streamsOpen === 0) this.closeLog();
		this.changed();
		for (const resolve of this.exitWaiters) resolve();
		this.exitWaiters.clear();
	}

	/** Forward raw output to a foreground listener; returns a detach function. */
	attach(listener: (chunk: Buffer) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Wait up to `waitMs` in the foreground. */
	waitForeground(waitMs: number, signal?: AbortSignal): Promise<ForegroundOutcome> {
		if (this.state !== "running") return Promise.resolve("exit");
		if (signal?.aborted) return Promise.resolve("abort");
		return new Promise((resolve) => {
			let timer: NodeJS.Timeout | undefined;
			const settle = (outcome: ForegroundOutcome) => {
				clearTimeout(timer);
				this.exitWaiters.delete(onExit);
				signal?.removeEventListener("abort", onAbort);
				resolve(outcome);
			};
			const onExit = () => settle("exit");
			const onAbort = () => settle("abort");
			this.exitWaiters.add(onExit);
			signal?.addEventListener("abort", onAbort, { once: true });
			timer = setTimeout(() => settle("background"), Math.max(0, waitMs));
		});
	}

	/** Resolves when the job has finished. */
	exited(): Promise<void> {
		if (this.state !== "running") return Promise.resolve();
		return new Promise((resolve) => this.exitWaiters.add(resolve));
	}

	/** Resolves after the background log stream closes. Absent for foreground-only jobs. */
	logClosed?: Promise<void>;

	/** @internal Move to the background: assign an id and start the log file. */
	background(id: string, logPath: string): void {
		this.id = id;
		this.backgrounded = true;
		this.backgroundedAt = Date.now();
		this.logPath = logPath;
		const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
		log.on("error", () => {});
		this.logClosed = new Promise((resolve) => log.once("close", resolve));
		if (this.foregroundDropped) log.write("[earlier output dropped]\n");
		for (const chunk of this.foreground ?? []) log.write(chunk);
		this.foreground = undefined;
		this.foregroundBytes = 0;
		this.log = log;
		if (this.streamsOpen === 0) this.closeLog();
		// A job that already finished in the window between the wait and now is unread too.
		if (this.state !== "running") this.unread = !this.killedByUser;
		this.changed();
	}

	private closeLog(): void {
		this.log?.end();
		this.log = undefined;
	}

	/** Stop the job: SIGTERM to its process group, SIGKILL after a grace period. */
	kill(by: "user" | "agent" = "agent"): boolean {
		if (this.state !== "running") return false;
		this.killedByUser = true;
		this.stoppedBy = by;
		this.terminate();
		return true;
	}

	private terminate(): void {
		this.signalGroup("SIGTERM");
		clearTimeout(this.killTimer);
		this.killTimer = setTimeout(() => {
			if (this.state === "running" || this.streamsOpen > 0) this.signalGroup("SIGKILL");
		}, KILL_GRACE_MS);
		this.killTimer.unref();
	}

	private signalGroup(signal: NodeJS.Signals): void {
		if (!this.pid) return;
		try {
			if (process.platform === "win32") this.child?.kill(signal);
			else process.kill(-this.pid, signal);
		} catch {
			// Already gone.
		}
	}

	markRead(byAgent = false): void {
		if (byAgent && this.state !== "running") this.agentSeen = true;
		if (!this.unread) return;
		this.unread = false;
		this.changed();
	}

	/** Decoded in-memory tail (at most TAIL_BYTES). */
	tailText(): string {
		return this.tail.text();
	}

	/** Whether the in-memory tail holds the complete output. */
	get tailComplete(): boolean {
		return this.outputBytes <= this.tail.bytes;
	}

	elapsedMs(now = Date.now()): number {
		return (this.endedAt ?? now) - this.startedAt;
	}

	private changed(): void {
		this.stateVersion++;
		this.manager.stateChanged(this);
	}
}

type Listener = (job: Job, change: JobChange) => void;

export class JobManager {
	private readonly jobs = new Map<string, Job>();
	private readonly running = new Set<Job>();
	private readonly listeners = new Set<Listener>();
	private readonly dirtyOutput = new Set<Job>();
	private outputTimer: NodeJS.Timeout | undefined;
	private seq = 0;
	private nextId = 1;
	logDir: string;
	private sessionLogDirs?: Map<string, string>;

	constructor(logDir = join(tmpdir(), `pi-bg-bash-${process.getuid?.() ?? process.pid}`)) {
		this.logDir = logDir;
	}

	start(options: StartOptions): Job {
		const job = new Job(this, ++this.seq, options);
		this.running.add(job);
		job.spawn(options);
		return job;
	}

	/** Move a foreground job to the background and list it. */
	background(job: Job, session = "default"): void {
		if (job.backgrounded) return;
		mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
		const info = lstatSync(this.logDir);
		if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()))
			throw new Error("Unsafe background log directory");
		chmodSync(this.logDir, 0o700);
		const directories = (this.sessionLogDirs ??= new Map());
		let dir = directories.get(session);
		if (!dir) {
			dir = mkdtempSync(join(this.logDir, `${session.replace(/[^\w.-]/gu, "_")}-`));
			directories.set(session, dir);
		}
		const id = `j${this.nextId++}`;
		this.jobs.set(id, job);
		job.background(id, join(dir, `${id}.log`));
	}

	/** Forget a job that completed in the foreground (it was never listed). */
	discard(job: Job): void {
		this.running.delete(job);
		this.dirtyOutput.delete(job);
	}

	get(id: string): Job | undefined {
		return this.jobs.get(id.trim().replace(/^#/u, ""));
	}

	/** Listed (backgrounded) jobs, newest first. */
	list(): Job[] {
		return [...this.jobs.values()].reverse();
	}

	get size(): number {
		return this.jobs.size;
	}

	remove(job: Job): boolean {
		if (job.state === "running" || !this.jobs.has(job.id)) return false;
		this.jobs.delete(job.id);
		if (job.logPath) void rm(job.logPath, { force: true });
		this.emit(job, "state");
		return true;
	}

	counts(): { running: number; unreadOk: number; unreadFailed: number } {
		let running = 0;
		let unreadOk = 0;
		let unreadFailed = 0;
		for (const job of this.jobs.values()) {
			if (job.state === "running") running++;
			else if (job.unread) {
				if (job.state === "exited" && job.exitCode === 0) unreadOk++;
				else unreadFailed++;
			}
		}
		return { running, unreadOk, unreadFailed };
	}

	onChange(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Kill every running process (listed or still in the foreground). */
	killAll(): void {
		for (const job of this.running) job.kill();
	}

	/** Kill everything and forget the listed jobs (session end). */
	async reset(): Promise<void> {
		const listed = [...this.jobs.values()];
		const running = [...this.running];
		const directories = [...(this.sessionLogDirs?.values() ?? [])];
		this.sessionLogDirs?.clear();
		this.killAll();
		this.jobs.clear();
		this.dirtyOutput.clear();
		clearTimeout(this.outputTimer);
		this.outputTimer = undefined;
		this.nextId = 1;
		await Promise.race([
			Promise.all(running.map((job) => job.exited())),
			new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + 500).unref()),
		]);
		await Promise.race([
			Promise.all(listed.map((job) => job.logClosed)),
			new Promise((resolve) => setTimeout(resolve, 1000).unref()),
		]);
		await Promise.all(listed.map((job) => (job.logPath ? rm(job.logPath, { force: true }) : undefined)));
		// Only directories allocated by this manager are recursively removed.
		await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
	}

	/** @internal */
	stateChanged(job: Job): void {
		if (job.state !== "running") this.running.delete(job);
		if (job.backgrounded) this.emit(job, "state");
	}

	/** @internal Coalesce output notifications: at most one event per job per interval. */
	outputChanged(job: Job): void {
		if (!job.backgrounded || this.listeners.size === 0) return;
		this.dirtyOutput.add(job);
		if (this.outputTimer) return;
		this.outputTimer = setTimeout(() => {
			this.outputTimer = undefined;
			const dirty = [...this.dirtyOutput];
			this.dirtyOutput.clear();
			for (const changed of dirty) {
				changed.outputVersion++;
				this.emit(changed, "output");
			}
		}, OUTPUT_EVENT_MS);
		this.outputTimer.unref();
	}

	private emit(job: Job, change: JobChange): void {
		for (const listener of this.listeners) listener(job, change);
	}
}

const REGISTRY = Symbol.for("@stagefright5/pi-bg-bash/v1");

/**
 * One manager per process, so jobs survive `/reload` (which replaces the extension runtime).
 *
 * A reload loads this module again, but the stored manager and its jobs were built by the previous
 * module's classes, so their methods would stay old until pi restarts. Adopt them into the current
 * classes instead: process handles, timers, and data carry over; behavior comes from this module.
 * Fields added since are absent on adopted objects, so new fields must tolerate `undefined`.
 */
export function jobManager(): JobManager {
	const store = globalThis as typeof globalThis & { [REGISTRY]?: JobManager };
	const existing = store[REGISTRY];
	if (!existing) return (store[REGISTRY] = new JobManager());
	if (!(existing instanceof JobManager)) adoptManager(existing);
	return existing;
}

function adoptManager(manager: JobManager): void {
	Object.setPrototypeOf(manager, JobManager.prototype);
	const internals = manager as unknown as { jobs?: Map<string, Job>; running?: Set<Job> };
	for (const job of [...(internals.jobs?.values() ?? []), ...(internals.running ?? [])]) {
		if (!(job instanceof Job)) Object.setPrototypeOf(job, Job.prototype);
	}
}

export type ReadOptions = { tailLines?: number; offset?: number; limit?: number; grep?: string };

/** Last `maxBytes` of a log file, starting at a line boundary when cut. */
async function readFileTail(path: string, maxBytes: number): Promise<{ text: string; cut: boolean }> {
	const handle = await open(path, "r");
	try {
		const { size } = await handle.stat();
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, size - length);
		const text = buffer.toString("utf8");
		if (length === size) return { text, cut: false };
		const newline = text.indexOf("\n");
		return { text: newline < 0 ? text : text.slice(newline + 1), cut: true };
	} finally {
		await handle.close();
	}
}

/** Stream a log file line by line (for offsets and grep over output larger than the tail). */
async function scanLines(path: string, visit: (line: string, number: number) => boolean): Promise<void> {
	const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
	let number = 0;
	try {
		for await (const line of lines) {
			if (!visit(line, ++number)) break;
		}
	} finally {
		lines.close();
	}
}

/** Job output for tools and the manager: a tail, a line range, or matching lines. */
export async function readJobOutput(
	job: Job,
	{ tailLines = 200, offset, limit = 200, grep }: ReadOptions,
): Promise<{ text: string; note?: string }> {
	const complete = job.tailComplete || !job.logPath;
	if (grep !== undefined) {
		let pattern: RegExp;
		try {
			pattern = new RegExp(grep, "iu");
		} catch {
			pattern = new RegExp(grep.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu");
		}
		const matches: string[] = [];
		const visit = (line: string, number: number) => {
			if (pattern.test(line)) matches.push(`${number}: ${line}`);
			return matches.length < limit;
		};
		if (complete)
			job.tailText()
				.split("\n")
				.every((line, index) => visit(line, index + 1));
		else await scanLines(job.logPath!, visit);
		return {
			text: matches.join("\n"),
			note: matches.length >= limit ? `first ${limit} matches` : `${matches.length} matching lines`,
		};
	}
	if (offset !== undefined) {
		const start = Math.max(1, Math.floor(offset));
		const lines: string[] = [];
		const visit = (line: string, number: number) => {
			if (number >= start) lines.push(line);
			return lines.length < limit;
		};
		if (complete)
			job.tailText()
				.split("\n")
				.every((line, index) => visit(line, index + 1));
		else await scanLines(job.logPath!, visit);
		return { text: lines.join("\n"), note: `lines ${start}-${start + Math.max(0, lines.length - 1)}` };
	}
	if (complete) return { text: lastLines(job.tailText(), tailLines) };
	// Long logs: read just enough of the file end for the requested lines.
	const { text, cut } = await readFileTail(job.logPath!, Math.max(TAIL_BYTES, tailLines * 400));
	return { text: lastLines(text, tailLines), note: cut ? "older output omitted" : undefined };
}
