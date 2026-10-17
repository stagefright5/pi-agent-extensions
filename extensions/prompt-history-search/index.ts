import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import lockfile from "proper-lockfile";
import { notifyIfActive } from "@stagefright5/pi-extension-utils";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	copyToClipboard,
	getAgentDir,
	parseSessionEntries,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
	type FileEntry,
} from "@earendil-works/pi-coding-agent";
import { createPicker, type FilterGroup, type PickerAction } from "@stagefright5/pi-picker";

type PromptRecord = {
	text: string;
	timestamp: number;
	sessionPath: string;
	sessionName?: string;
	cwd: string;
};

type CachedSession = {
	modifiedMs: number;
	prompts: PromptRecord[];
	malformed: boolean;
};

type PromptIndex = {
	prompts: PromptRecord[];
	warnings: number;
};

type PromptSessionInfo = {
	path: string;
	name?: string;
	cwd: string;
};

/** A prompt deleted from history; kept until it ages out so session rescans cannot restore it. */
type Tombstone = { key: string; timestamp: number };

type PersistedPromptIndex = {
	version: 1;
	updatedAt: number;
	bootstrappedAt?: number;
	prompts: PromptRecord[];
	/** Optional; older readers ignore it. */
	deleted?: Tombstone[];
};

type LoadedPersistedIndex = {
	existed: boolean;
	/** The file exists but could not be read or parsed; it must never be overwritten blindly. */
	unreadable: boolean;
	bootstrappedAt?: number;
	prompts: PromptRecord[];
	deleted: Tombstone[];
	warnings: number;
	pruned: boolean;
};

const SESSION_SCAN_CONCURRENCY = 8;
const INDEX_VERSION = 1;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Pi's native editor keeps 100 Up/Down entries. */
const RECALL_LIMIT = 100;
export function historyIndexPath(): string {
	return join(getAgentDir(), "prompt-history-search", "index.json");
}

const sessionCache = new Map<string, CachedSession>();
let indexWriteQueue: Promise<void> = Promise.resolve();

function textFromUserContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";

	return content
		.filter((block): block is { type: "text"; text: string } => {
			if (!block || typeof block !== "object") return false;
			const candidate = block as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string";
		})
		.map((block) => block.text)
		.join("\n")
		.trim();
}

function timestampForEntry(entry: FileEntry): number {
	if (entry.type === "message" && entry.message && typeof entry.message === "object") {
		const messageTimestamp = (entry.message as { timestamp?: unknown }).timestamp;
		if (typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)) {
			return messageTimestamp;
		}
	}

	if (entry.type !== "session") {
		const parsed = Date.parse(entry.timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}

	return 0;
}

function promptsFromEntries(entries: FileEntry[], session: PromptSessionInfo): PromptRecord[] {
	const prompts: PromptRecord[] = [];

	for (const entry of entries) {
		if (!entry || typeof entry !== "object" || entry.type !== "message") continue;
		const message = entry.message as unknown;
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "user") continue;
		const content = "content" in message ? message.content : undefined;
		const text = textFromUserContent(content);
		if (!text) continue;

		prompts.push({
			text,
			timestamp: timestampForEntry(entry),
			sessionPath: session.path,
			sessionName: session.name,
			cwd: session.cwd,
		});
	}

	return prompts;
}

function sessionInfoFromEntries(entries: FileEntry[], path: string): PromptSessionInfo {
	const header = entries.find((entry) => entry.type === "session") as ({ cwd?: unknown } & FileEntry) | undefined;
	let name: string | undefined;

	for (const entry of entries) {
		if (entry.type !== "session_info") continue;
		const candidate = (entry as { name?: unknown }).name;
		name = typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
	}

	return {
		path,
		name,
		cwd: typeof header?.cwd === "string" ? header.cwd : "",
	};
}

function cutoffTimestamp(now = Date.now()): number {
	return now - RETENTION_MS;
}

function prunePrompts(prompts: PromptRecord[], now = Date.now()): PromptRecord[] {
	const cutoff = cutoffTimestamp(now);
	return prompts.filter((prompt) => Number.isFinite(prompt.timestamp) && prompt.timestamp >= cutoff);
}

function promptKey(prompt: PromptRecord): string {
	return [prompt.timestamp, prompt.sessionPath, prompt.cwd, prompt.text].join("\0");
}

function mergePrompts(promptLists: PromptRecord[][], deleted: readonly Tombstone[] = []): PromptRecord[] {
	const removed = new Set(deleted.map((tombstone) => tombstone.key));
	const merged = new Map<string, PromptRecord>();
	for (const prompts of promptLists) {
		for (const prompt of prompts) {
			const key = promptKey(prompt);
			if (!removed.has(key)) merged.set(key, prompt);
		}
	}
	return prunePrompts([...merged.values()]).sort((a, b) => b.timestamp - a.timestamp);
}

function pruneTombstones(deleted: readonly Tombstone[], now = Date.now()): Tombstone[] {
	const cutoff = cutoffTimestamp(now);
	return deleted.filter((tombstone) => tombstone.timestamp >= cutoff);
}

function tombstoneFromUnknown(value: unknown): Tombstone | null {
	if (!value || typeof value !== "object") return null;
	const { key, timestamp } = value as { key?: unknown; timestamp?: unknown };
	return typeof key === "string" && typeof timestamp === "number" && Number.isFinite(timestamp)
		? { key, timestamp }
		: null;
}

function promptRecordFromUnknown(value: unknown): PromptRecord | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as {
		text?: unknown;
		timestamp?: unknown;
		sessionPath?: unknown;
		sessionName?: unknown;
		cwd?: unknown;
	};
	if (typeof candidate.text !== "string" || !candidate.text.trim()) return null;
	if (typeof candidate.timestamp !== "number" || !Number.isFinite(candidate.timestamp)) return null;

	return {
		text: candidate.text.trim(),
		timestamp: candidate.timestamp,
		sessionPath: typeof candidate.sessionPath === "string" ? candidate.sessionPath : "",
		sessionName: typeof candidate.sessionName === "string" ? candidate.sessionName : undefined,
		cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
	};
}

async function readPersistedIndex(indexPath = historyIndexPath()): Promise<LoadedPersistedIndex> {
	let raw: string;
	try {
		raw = await readFile(indexPath, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
			return { existed: false, unreadable: false, prompts: [], deleted: [], warnings: 0, pruned: false };
		}
		return { existed: true, unreadable: true, prompts: [], deleted: [], warnings: 1, pruned: false };
	}

	try {
		const parsed = JSON.parse(raw) as Partial<PersistedPromptIndex>;
		const originalPrompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];
		const validPrompts = originalPrompts.map(promptRecordFromUnknown).filter((p): p is PromptRecord => p !== null);
		const deleted = pruneTombstones(
			(Array.isArray(parsed.deleted) ? parsed.deleted : [])
				.map(tombstoneFromUnknown)
				.filter((t): t is Tombstone => t !== null),
		);
		const prompts = mergePrompts([validPrompts], deleted);
		const bootstrappedAt =
			typeof parsed.bootstrappedAt === "number" && Number.isFinite(parsed.bootstrappedAt)
				? parsed.bootstrappedAt
				: undefined;

		return {
			existed: true,
			unreadable: false,
			bootstrappedAt,
			prompts,
			deleted,
			warnings: parsed.version === INDEX_VERSION ? 0 : 1,
			pruned: prompts.length !== originalPrompts.length,
		};
	} catch {
		return { existed: true, unreadable: true, prompts: [], deleted: [], warnings: 1, pruned: false };
	}
}

async function writePersistedIndex(
	indexPath: string,
	prompts: PromptRecord[],
	bootstrappedAt?: number,
	deleted: readonly Tombstone[] = [],
): Promise<void> {
	const tombstones = pruneTombstones(deleted);
	const payload: PersistedPromptIndex = {
		version: INDEX_VERSION,
		updatedAt: Date.now(),
		bootstrappedAt,
		prompts: mergePrompts([prompts], tombstones),
		...(tombstones.length ? { deleted: tombstones } : {}),
	};
	const tempPath = `${indexPath}.${randomUUID()}.tmp`;
	await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
	try {
		await writeFile(tempPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		await rename(tempPath, indexPath);
	} finally {
		await rm(tempPath, { force: true });
	}
}

async function updatePersistedIndex(
	update: (current: LoadedPersistedIndex) => {
		prompts: PromptRecord[];
		bootstrappedAt?: number;
		deleted?: readonly Tombstone[];
	},
): Promise<PromptRecord[]> {
	let updatedPrompts: PromptRecord[] = [];
	// Capture the profile at submission, before queued work or session replacement.
	const indexPath = historyIndexPath();
	const run = indexWriteQueue
		.catch(() => undefined)
		.then(async () => {
			await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
			// Atomic rename alone cannot protect a cross-process read/modify/write.
			const release = await lockfile.lock(indexPath, {
				realpath: false,
				retries: { retries: 100, minTimeout: 10, maxTimeout: 100 },
			});
			try {
				const current = await readPersistedIndex(indexPath);
				if (current.unreadable) {
					await rename(indexPath, `${indexPath}.unreadable-${Date.now()}`);
				}
				const next = update(current);
				const deleted = next.deleted ?? current.deleted;
				updatedPrompts = mergePrompts([next.prompts], deleted);
				await writePersistedIndex(indexPath, updatedPrompts, next.bootstrappedAt, deleted);
			} finally {
				await release();
			}
		});
	indexWriteQueue = run;
	await run;
	return updatedPrompts;
}

/** Remove prompts from history and remember them so later session rescans cannot restore them. */
export async function deletePromptsFromPersistedIndex(prompts: readonly PromptRecord[]): Promise<void> {
	const deleted = prompts.map((prompt) => ({ key: promptKey(prompt), timestamp: prompt.timestamp }));
	await updatePersistedIndex((current) => ({
		prompts: current.prompts,
		bootstrappedAt: current.bootstrappedAt,
		deleted: [...current.deleted, ...deleted],
	}));
}

async function appendPromptToPersistedIndex(prompt: PromptRecord): Promise<void> {
	await updatePersistedIndex((current) => ({
		prompts: [...current.prompts, prompt],
		bootstrappedAt: current.bootstrappedAt,
	}));
}

async function loadSessionPrompts(path: string, modifiedMs: number): Promise<CachedSession> {
	const content = await readFile(path, "utf8");
	const nonEmptyLineCount = content.split("\n").filter((line) => line.trim().length > 0).length;
	const entries = parseSessionEntries(content);
	const session = sessionInfoFromEntries(entries, path);

	return {
		modifiedMs,
		prompts: prunePrompts(promptsFromEntries(entries, session)),
		malformed: entries.length !== nonEmptyLineCount,
	};
}

export async function discoverSessionFiles(sessionDir?: string): Promise<string[]> {
	// Let pi resolve profile paths and validate session headers. An explicit directory
	// covers --session-dir and SDK-created sessions outside the normal profile tree.
	const sessions = sessionDir ? await SessionManager.listAll(sessionDir) : await SessionManager.listAll();
	return sessions.map((session) => session.path);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index]!);
		}
	}

	const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

async function buildPromptIndexFromSessions(sessionDir?: string): Promise<PromptIndex> {
	let files: string[];
	try {
		files = await discoverSessionFiles(sessionDir);
	} catch {
		return { prompts: [], warnings: 1 };
	}

	const activePaths = new Set(files);
	let warnings = 0;

	for (const path of sessionCache.keys()) {
		if (!activePaths.has(path)) sessionCache.delete(path);
	}

	const perSession = await mapWithConcurrency(
		files,
		SESSION_SCAN_CONCURRENCY,
		async (path): Promise<PromptRecord[]> => {
			try {
				const stats = await stat(path);
				const modifiedMs = stats.mtime.getTime();
				const cached = sessionCache.get(path);
				if (cached?.modifiedMs === modifiedMs) {
					if (cached.malformed) warnings++;
					return cached.prompts;
				}

				const loaded = await loadSessionPrompts(path, modifiedMs);
				sessionCache.set(path, loaded);
				if (loaded.malformed) warnings++;
				return loaded.prompts;
			} catch {
				warnings++;
				sessionCache.delete(path);
				return [];
			}
		},
	);

	return {
		prompts: mergePrompts(perSession),
		warnings,
	};
}

export async function loadPromptIndexForSearch(sessionDir: string, onBackfillStart?: () => void): Promise<PromptIndex> {
	await indexWriteQueue.catch(() => undefined);
	const loaded = await readPersistedIndex();
	let warnings = loaded.warnings;

	if (loaded.bootstrappedAt === undefined) {
		onBackfillStart?.();
		const [built, currentDirectory] = await Promise.all([
			buildPromptIndexFromSessions(),
			buildPromptIndexFromSessions(sessionDir),
		]);
		warnings += built.warnings + currentDirectory.warnings;
		const bootstrappedAt = Date.now();
		const prompts = await updatePersistedIndex((current) => ({
			prompts: [...current.prompts, ...built.prompts, ...currentDirectory.prompts],
			bootstrappedAt,
		}));
		return { prompts, warnings };
	}

	// A session replacement may point at a custom directory that was not part of
	// the initial profile-wide backfill. Refresh that directory on every search.
	const currentDirectory = await buildPromptIndexFromSessions(sessionDir);
	const prompts = await updatePersistedIndex((current) => ({
		prompts: [...current.prompts, ...currentDirectory.prompts],
		bootstrappedAt: current.bootstrappedAt,
	}));
	return { prompts, warnings: warnings + currentDirectory.warnings };
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function formatDate(timestamp: number): string {
	if (!timestamp) return "unknown date";
	return new Date(timestamp).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Compact list date: time today, otherwise month and day (year only when it differs). */
function formatShortDate(timestamp: number, now: number): string {
	if (!timestamp) return "?";
	const date = new Date(timestamp);
	const today = new Date(now);
	if (date.toDateString() === today.toDateString()) {
		return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
	});
}

function shouldIndexInputText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.length > 0 && !trimmed.startsWith("/");
}

async function openPromptHistory(ctx: ExtensionContext, initialQuery?: string): Promise<void> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify("Prompt history is available only in interactive TUI mode", "warning");
		return;
	}

	const originalDraft = ctx.ui.getEditorText();
	let index: PromptIndex;
	ctx.ui.setStatus("prompt-history-search", "Loading prompt history index…");
	try {
		// /prompt-history itself may have just queued a slash-command record.
		await indexWriteQueue.catch(() => undefined);
		index = await loadPromptIndexForSearch(ctx.sessionManager.getSessionDir(), () => {
			ctx.ui.setStatus("prompt-history-search", "Building initial 30-day prompt history index…");
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`Could not load prompt history: ${message}`, "error");
		return;
	} finally {
		ctx.ui.setStatus("prompt-history-search", undefined);
	}

	if (index.prompts.length === 0) {
		ctx.ui.notify("No saved user prompts found", "info");
		return;
	}

	let pickerTui: { requestRender(): void } | undefined;
	const selected = await ctx.ui.custom<string | null>(
		(tui, theme, keybindings, done) => {
			pickerTui = tui;
			return createPromptHistoryPicker({
				tui,
				theme: () => theme,
				keybindings,
				prompts: index.prompts,
				warnings: index.warnings,
				initialQuery: initialQuery ?? originalDraft,
				cwd: ctx.cwd,
				sessionPath: ctx.sessionManager.getSessionFile() ?? "",
				done,
			});
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 50, maxHeight: "85%" } },
	);

	if (selected !== null && selected !== undefined) {
		ctx.ui.setEditorText(selected);
		// Pi redraws when the overlay closes, before this text lands; setEditorText alone does not
		// schedule a frame, so the draft would stay stale until the next keypress.
		pickerTui?.requestRender();
	}
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PromptHistoryPickerOptions {
	tui: Parameters<typeof createPicker>[0]["tui"];
	theme: Parameters<typeof createPicker>[0]["theme"];
	keybindings: Parameters<typeof createPicker>[0]["keybindings"];
	prompts: readonly PromptRecord[];
	warnings: number;
	initialQuery: string;
	cwd: string;
	sessionPath: string;
	done: (value: string | null) => void;
	now?: number;
	copy?: (text: string) => Promise<void>;
	delete?: (prompts: readonly PromptRecord[]) => Promise<void>;
}

export function createPromptHistoryPicker(options: PromptHistoryPickerOptions) {
	const now = options.now ?? Date.now();
	const newest = options.prompts[0]?.timestamp ?? now;
	const oldest = options.prompts.at(-1)?.timestamp ?? now;
	const span = Math.max(1, newest - oldest);
	const joined = (items: readonly PromptRecord[]) => items.map((item) => item.text).join("\n\n");
	const sessionLabel = (prompt: PromptRecord) => {
		const file = prompt.sessionPath ? basename(prompt.sessionPath, ".jsonl") : "current session";
		return prompt.sessionName?.trim() ? `${prompt.sessionName.trim()} · ${file}` : file;
	};
	const filters: FilterGroup<PromptRecord>[] = [
		{
			id: "scope",
			label: "Scope",
			exclusive: true,
			options: [
				{ id: "project", label: "this project", test: (prompt) => prompt.cwd === options.cwd },
				{
					id: "session",
					label: "this session",
					test: (prompt) => options.sessionPath !== "" && prompt.sessionPath === options.sessionPath,
				},
			],
		},
		{
			id: "age",
			label: "Age",
			exclusive: true,
			options: [
				{ id: "day", label: "24 hours", test: (prompt) => now - prompt.timestamp <= DAY_MS },
				{ id: "week", label: "7 days", test: (prompt) => now - prompt.timestamp <= 7 * DAY_MS },
			],
		},
		{
			id: "kind",
			label: "Kind",
			exclusive: true,
			options: [
				{ id: "prompts", label: "prompts", test: (prompt) => !prompt.text.startsWith("/") },
				{ id: "commands", label: "commands", test: (prompt) => prompt.text.startsWith("/") },
			],
		},
	];
	const actions: PickerAction<PromptRecord>[] = [
		{
			id: "insert",
			label: "insert",
			key: "tui.select.confirm",
			primary: true,
			run: (items) => options.done(joined(items)),
		},
		{
			id: "copy",
			label: "copy",
			key: "ctrl+y",
			run: async (items, context) => {
				await (options.copy ?? copyToClipboard)(joined(items));
				context.notify(items.length === 1 ? "Copied" : `Copied ${items.length} prompts`);
			},
		},
		{
			id: "delete",
			label: "delete",
			key: "ctrl+d",
			confirm: (items) =>
				`Press ⌃D again to delete ${items.length === 1 ? "this prompt" : `${items.length} prompts`} from history`,
			run: async (items, context) => {
				await (options.delete ?? deletePromptsFromPersistedIndex)(items);
				context.remove(items);
				context.notify(items.length === 1 ? "Deleted" : `Deleted ${items.length} prompts`);
			},
		},
	];
	return createPicker<PromptRecord>({
		tui: options.tui,
		theme: options.theme,
		keybindings: options.keybindings,
		title: "Prompt history · last 30 days",
		items: options.prompts,
		text: (prompt) => prompt.text,
		row: (prompt) => ({
			primary: prompt.text.replace(/\s+/gu, " ").trim(),
			secondary: `${formatShortDate(prompt.timestamp, now)} · ${basename(prompt.cwd) || "~"}`,
		}),
		preview: (prompt) =>
			`${formatDate(prompt.timestamp)} · ${sessionLabel(prompt)} · ${shortenPath(prompt.cwd)}\n\n${prompt.text}`,
		filters,
		actions,
		multiSelect: true,
		initialQuery: options.initialQuery.replace(/\s+/gu, " ").trim(),
		// Prompts arrive newest first; recency breaks ties between equally good matches.
		boost: (prompt) => (prompt.timestamp - oldest) / span,
		nextKeys: ["alt+r"],
		emptyMessage: "No matching prompts",
		...(options.warnings > 0
			? {
					notice: {
						text: `Skipped, partially read, or repaired ${options.warnings} index/session file(s)`,
						tone: "warning" as const,
					},
				}
			: {}),
		onClose: () => options.done(null),
	});
}

export default function promptHistorySearchExtension(pi: ExtensionAPI): void {
	let uiContext: ExtensionContext | undefined;
	let session = new AbortController();
	pi.on("session_start", (_event, ctx) => {
		session.abort();
		session = new AbortController();
		const { signal } = session;
		uiContext = ctx;
		if (ctx.mode !== "tui") return;
		// Offer persisted prompts (all projects, newest first) to an Up/Down-capable
		// editor. Reads only the saved index; it never scans sessions at startup.
		void indexWriteQueue
			.catch(() => undefined)
			.then(() => readPersistedIndex())
			.then((index) => {
				if (signal.aborted) return;
				const prompts = [...new Set(index.prompts.map((prompt) => prompt.text))].slice(0, RECALL_LIMIT);
				if (prompts.length) pi.events.emit("prompt-history-search:recent", { prompts });
			})
			.catch(() => undefined);
	});

	// Built-in and extension slash commands can bypass the input event entirely.
	// The optional composer integration reports actual submissions, never selections.
	pi.events.on("prompt-truly-mine:slash-submit", (value) => {
		const prompt = promptRecordFromUnknown(value);
		if (!prompt?.text.startsWith("/")) return;
		const ctx = uiContext;
		const { signal } = session;
		void appendPromptToPersistedIndex(prompt).catch((error: unknown) => {
			if (ctx) notifyIfActive(signal, ctx, `Could not persist command history: ${String(error)}`);
		});
	});
	pi.on("session_shutdown", async () => {
		// Stop UI work before draining persistence, including on /reload and replacement.
		session.abort();
		uiContext = undefined;
		await indexWriteQueue.catch(() => undefined);
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension" || !shouldIndexInputText(event.text)) return { action: "continue" as const };

		const { signal } = session;
		void appendPromptToPersistedIndex({
			text: event.text.trim(),
			timestamp: Date.now(),
			sessionPath: ctx.sessionManager.getSessionFile() ?? "",
			sessionName: ctx.sessionManager.getSessionName(),
			cwd: ctx.cwd,
		}).catch((error: unknown) => {
			notifyIfActive(signal, ctx, `Could not persist prompt history: ${String(error)}`);
		});

		return { action: "continue" as const };
	});

	pi.registerShortcut("alt+r", {
		description: "Reverse-search persisted user prompts",
		handler: async (ctx) => openPromptHistory(ctx),
	});

	pi.registerCommand("prompt-history", {
		description: "Search persisted user prompts from the last 30 days",
		handler: async (args, ctx) => openPromptHistory(ctx, args.trim()),
	});
}
