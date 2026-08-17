import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
	parseSessionEntries,
	type ExtensionAPI,
	type ExtensionContext,
	type FileEntry,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyMatch,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

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

type PersistedPromptIndex = {
	version: 1;
	updatedAt: number;
	bootstrappedAt?: number;
	prompts: PromptRecord[];
};

type LoadedPersistedIndex = {
	existed: boolean;
	bootstrappedAt?: number;
	prompts: PromptRecord[];
	warnings: number;
	pruned: boolean;
};

const MAX_VISIBLE = 8;
const SESSION_SCAN_CONCURRENCY = 8;
const INDEX_VERSION = 1;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const INDEX_PATH = join(homedir(), ".pi", "agent", "prompt-history-search", "index.json");
const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

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

function mergePrompts(...promptLists: PromptRecord[][]): PromptRecord[] {
	const merged = new Map<string, PromptRecord>();
	for (const prompts of promptLists) {
		for (const prompt of prompts) {
			merged.set(promptKey(prompt), prompt);
		}
	}
	return prunePrompts([...merged.values()]).sort((a, b) => b.timestamp - a.timestamp);
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

async function readPersistedIndex(): Promise<LoadedPersistedIndex> {
	let raw: string;
	try {
		raw = await readFile(INDEX_PATH, "utf8");
	} catch (error) {
		if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
			return { existed: false, prompts: [], warnings: 0, pruned: false };
		}
		return { existed: false, prompts: [], warnings: 1, pruned: false };
	}

	try {
		const parsed = JSON.parse(raw) as Partial<PersistedPromptIndex>;
		const originalPrompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];
		const validPrompts = originalPrompts.map(promptRecordFromUnknown).filter((p): p is PromptRecord => p !== null);
		const prompts = mergePrompts(validPrompts);
		const bootstrappedAt =
			typeof parsed.bootstrappedAt === "number" && Number.isFinite(parsed.bootstrappedAt)
				? parsed.bootstrappedAt
				: undefined;

		return {
			existed: true,
			bootstrappedAt,
			prompts,
			warnings: parsed.version === INDEX_VERSION ? 0 : 1,
			pruned: prompts.length !== originalPrompts.length,
		};
	} catch {
		return { existed: true, prompts: [], warnings: 1, pruned: false };
	}
}

async function writePersistedIndex(prompts: PromptRecord[], bootstrappedAt?: number): Promise<void> {
	const pruned = mergePrompts(prompts);
	const payload: PersistedPromptIndex = {
		version: INDEX_VERSION,
		updatedAt: Date.now(),
		bootstrappedAt,
		prompts: pruned,
	};
	const tempPath = `${INDEX_PATH}.${process.pid}.tmp`;
	await mkdir(dirname(INDEX_PATH), { recursive: true });
	await writeFile(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
	await rename(tempPath, INDEX_PATH);
}

async function updatePersistedIndex(
	update: (current: LoadedPersistedIndex) => { prompts: PromptRecord[]; bootstrappedAt?: number },
): Promise<PromptRecord[]> {
	let updatedPrompts: PromptRecord[] = [];
	const run = indexWriteQueue.catch(() => undefined).then(async () => {
		const current = await readPersistedIndex();
		const next = update(current);
		updatedPrompts = mergePrompts(next.prompts);
		await writePersistedIndex(updatedPrompts, next.bootstrappedAt);
	});
	indexWriteQueue = run;
	await run;
	return updatedPrompts;
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

async function discoverSessionFiles(): Promise<string[]> {
	const entries = await readdir(SESSIONS_ROOT, { withFileTypes: true });
	const dirs = entries
		.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
		.map((entry) => join(SESSIONS_ROOT, entry.name));

	const perDir = await Promise.all(
		dirs.map(async (dir): Promise<string[]> => {
			try {
				const files = await readdir(dir);
				return files.filter((file) => file.endsWith(".jsonl")).map((file) => join(dir, file));
			} catch {
				return [];
			}
		}),
	);

	return perDir.flat();
}

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
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

async function buildPromptIndexFromSessions(): Promise<PromptIndex> {
	let files: string[];
	try {
		files = await discoverSessionFiles();
	} catch {
		return { prompts: [], warnings: 1 };
	}

	const activePaths = new Set(files);
	let warnings = 0;

	for (const path of sessionCache.keys()) {
		if (!activePaths.has(path)) sessionCache.delete(path);
	}

	const perSession = await mapWithConcurrency(files, SESSION_SCAN_CONCURRENCY, async (path): Promise<PromptRecord[]> => {
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
	});

	return {
		prompts: mergePrompts(...perSession),
		warnings,
	};
}

async function loadPromptIndexForSearch(onBackfillStart?: () => void): Promise<PromptIndex> {
	await indexWriteQueue.catch(() => undefined);
	const loaded = await readPersistedIndex();
	let warnings = loaded.warnings;

	if (loaded.bootstrappedAt === undefined) {
		onBackfillStart?.();
		const built = await buildPromptIndexFromSessions();
		warnings += built.warnings;
		const bootstrappedAt = Date.now();
		const prompts = await updatePersistedIndex((current) => ({
			prompts: [...current.prompts, ...built.prompts],
			bootstrappedAt,
		}));
		return { prompts, warnings };
	}

	if (loaded.pruned) {
		await updatePersistedIndex((current) => ({
			prompts: current.prompts,
			bootstrappedAt: current.bootstrappedAt,
		}));
	}

	return {
		prompts: loaded.prompts,
		warnings,
	};
}

function normalizeSingleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function queryTokens(query: string): string[] {
	return normalizeSingleLine(query).split(/\s+/).filter(Boolean);
}

function tokenMatchScore(token: string, text: string): number | null {
	const lowerText = text.toLowerCase();
	const lowerToken = token.toLowerCase();
	const substringIndex = lowerText.indexOf(lowerToken);

	if (substringIndex >= 0) {
		const wordBoundary = substringIndex === 0 || /[\s\-_./:]/.test(lowerText[substringIndex - 1]!);
		return substringIndex * 0.1 - (wordBoundary ? 10 : 0) - lowerToken.length;
	}

	const fuzzy = fuzzyMatch(token, text);
	return fuzzy.matches ? 1000 + fuzzy.score : null;
}

function promptMatchScore(prompt: PromptRecord, query: string): number | null {
	const searchable = normalizeSingleLine(prompt.text);
	const normalizedQuery = normalizeSingleLine(query);
	const tokens = queryTokens(query);
	if (tokens.length === 0) return 0;

	let score = 0;
	for (const token of tokens) {
		const tokenScore = tokenMatchScore(token, searchable);
		if (tokenScore === null) return null;
		score += tokenScore;
	}

	const lowered = searchable.toLowerCase();
	const loweredQuery = normalizedQuery.toLowerCase();
	const phraseIndex = lowered.indexOf(loweredQuery);
	if (phraseIndex >= 0) {
		score -= 500;
		score += phraseIndex * 0.05;
	}
	if (lowered === loweredQuery) {
		score -= 1000;
	}

	return score;
}

function promptMatches(prompt: PromptRecord, query: string): boolean {
	return promptMatchScore(prompt, query) !== null;
}

type MatchRange = {
	start: number;
	end: number;
};

function fuzzyMatchRanges(token: string, text: string): MatchRange[] {
	const tokenLower = token.toLowerCase();
	const textLower = text.toLowerCase();
	const ranges: MatchRange[] = [];
	let tokenIndex = 0;

	for (let i = 0; i < textLower.length && tokenIndex < tokenLower.length; i++) {
		if (textLower[i] === tokenLower[tokenIndex]) {
			ranges.push({ start: i, end: i + 1 });
			tokenIndex++;
		}
	}

	return tokenIndex === tokenLower.length ? ranges : [];
}

function matchRangesForQuery(text: string, query: string): MatchRange[] {
	const tokens = queryTokens(query);
	if (tokens.length === 0) return [];

	const lowerText = text.toLowerCase();
	const ranges: MatchRange[] = [];

	for (const token of tokens) {
		const lowerToken = token.toLowerCase();
		const exactRanges: MatchRange[] = [];
		let start = lowerText.indexOf(lowerToken);
		while (start >= 0) {
			exactRanges.push({ start, end: start + token.length });
			start = lowerText.indexOf(lowerToken, start + Math.max(1, token.length));
		}

		if (exactRanges.length > 0) {
			ranges.push(...exactRanges);
		} else if (fuzzyMatch(token, text).matches) {
			ranges.push(...fuzzyMatchRanges(token, text));
		}
	}

	return mergeRanges(ranges);
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
	const sorted = ranges
		.filter((range) => range.end > range.start)
		.sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: MatchRange[] = [];

	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (!previous || range.start > previous.end) {
			merged.push({ ...range });
		} else {
			previous.end = Math.max(previous.end, range.end);
		}
	}

	return merged;
}

function excerptAroundFirstMatch(text: string, ranges: MatchRange[], maxWidth: number): { text: string; ranges: MatchRange[] } {
	const width = Math.max(1, maxWidth);
	if (visibleWidth(text) <= width) return { text, ranges };

	if (ranges.length === 0) {
		return { text: truncateToWidth(text, width, "…"), ranges: [] };
	}

	const first = ranges[0]!;
	const last = ranges[ranges.length - 1]!;
	const hasLeadingEllipsis = first.start > 0;
	const hasTrailingEllipsis = last.end < text.length;
	const markerWidth = (hasLeadingEllipsis ? 1 : 0) + (hasTrailingEllipsis ? 1 : 0);
	const contentWidth = Math.max(1, width - markerWidth);
	const fullMatchSpan = last.end - first.start;
	const focus = fullMatchSpan <= contentWidth ? { start: first.start, end: last.end } : first;
	const matchLength = Math.max(1, focus.end - focus.start);
	let start = focus.start;

	if (matchLength < contentWidth) {
		start = focus.start - Math.floor((contentWidth - matchLength) / 2);
	}
	start = Math.max(0, Math.min(start, Math.max(0, text.length - contentWidth)));
	let end = Math.min(text.length, start + contentWidth);
	if (focus.end > end) {
		end = Math.min(text.length, focus.end);
		start = Math.max(0, end - contentWidth);
	}

	const prefix = start > 0 ? "…" : "";
	const suffix = end < text.length ? "…" : "";
	const excerpt = `${prefix}${text.slice(start, end)}${suffix}`;
	const mappedRanges = ranges
		.map((range) => ({
			start: Math.max(range.start, start) - start + prefix.length,
			end: Math.min(range.end, end) - start + prefix.length,
		}))
		.filter((range) => range.end > range.start);

	return { text: excerpt, ranges: mappedRanges };
}

function highlightRanges(text: string, ranges: MatchRange[], theme: Theme): string {
	if (ranges.length === 0) return text;

	let rendered = "";
	let offset = 0;
	for (const range of ranges) {
		rendered += text.slice(offset, range.start);
		rendered += theme.bg("searchMatchBg", theme.fg("searchMatchText", theme.bold(text.slice(range.start, range.end))));
		offset = range.end;
	}
	rendered += text.slice(offset);
	return rendered;
}

function highlightedPromptText(text: string, query: string, theme: Theme): string {
	const displayText = text.trim();
	return highlightRanges(displayText, matchRangesForQuery(displayText, query), theme);
}

function highlightedPromptExcerpt(text: string, query: string, maxWidth: number, theme: Theme): string {
	const displayText = normalizeSingleLine(text);
	const ranges = matchRangesForQuery(displayText, query);
	const excerpt = excerptAroundFirstMatch(displayText, ranges, maxWidth);
	return highlightRanges(excerpt.text, excerpt.ranges, theme);
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

function shouldIndexInputText(text: string): boolean {
	const trimmed = text.trim();
	return trimmed.length > 0 && !trimmed.startsWith("/");
}

class PromptHistorySearchComponent implements Component, Focusable {
	private readonly input = new Input();
	private filtered: PromptRecord[];
	private selectedIndex = 0;
	private expandedSelected = false;
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly prompts: PromptRecord[],
		initialQuery: string,
		private readonly warnings: number,
		private readonly done: (value: string | null) => void,
	) {
		this.input.setValue(normalizeSingleLine(initialQuery));
		this.filtered = this.filterPrompts();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.alt("r"))) {
			this.moveSelection(1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down")) {
			this.moveSelection(1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.pageUp")) {
			this.moveSelection(-MAX_VISIBLE);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.pageDown")) {
			this.moveSelection(MAX_VISIBLE);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.expandedSelected = true;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.expandedSelected = false;
			this.tui.requestRender();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			const selected = this.filtered[this.selectedIndex];
			if (selected) this.done(selected.text);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(null);
			return;
		}

		const before = this.input.getValue();
		this.input.handleInput(data);
		if (this.input.getValue() !== before) {
			this.filtered = this.filterPrompts();
			this.selectedIndex = 0;
			this.expandedSelected = false;
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const title = `Prompt History - last 30 days (${this.filtered.length}/${this.prompts.length})`;
		lines.push(truncateToWidth(this.theme.fg("accent", this.theme.bold(title)), width, ""));

		const queryPrefix = this.theme.fg("muted", "reverse-i-search: ");
		const queryWidth = Math.max(1, width - visibleWidth(queryPrefix));
		const inputLine = this.input.render(queryWidth)[0] ?? "";
		lines.push(truncateToWidth(queryPrefix + inputLine, width, ""));
		lines.push(this.theme.fg("borderMuted", "─".repeat(Math.max(0, width))));

		if (this.filtered.length === 0) {
			lines.push(truncateToWidth(this.theme.fg("warning", "  No matching prompts"), width, ""));
		} else {
			const start = Math.max(
				0,
				Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), this.filtered.length - MAX_VISIBLE),
			);
			const end = Math.min(start + MAX_VISIBLE, this.filtered.length);

			for (let index = start; index < end; index++) {
				const prompt = this.filtered[index]!;
				const selected = index === this.selectedIndex;
				const prefix = selected ? "› " : "  ";
				const previewTextWidth = Math.max(1, width - visibleWidth(prefix));
				const preview = truncateToWidth(
					prefix + highlightedPromptExcerpt(prompt.text, this.input.getValue(), previewTextWidth, this.theme),
					width,
					"…",
				);
				const sessionFile = prompt.sessionPath ? basename(prompt.sessionPath, ".jsonl") : "current session";
				const sessionLabel = prompt.sessionName?.trim()
					? `${prompt.sessionName.trim()} · ${sessionFile}`
					: sessionFile;
				const metadata = truncateToWidth(
					`  ${formatDate(prompt.timestamp)} · ${sessionLabel} · ${shortenPath(prompt.cwd)}`,
					width,
					"…",
				);

				if (selected) {
					lines.push(this.theme.bg("selectedBg", this.theme.fg("accent", preview)));
					lines.push(this.theme.bg("selectedBg", this.theme.fg("muted", metadata)));
					if (this.expandedSelected) {
						lines.push(...this.renderExpandedPrompt(prompt, width));
					}
				} else {
					lines.push(preview);
					lines.push(this.theme.fg("dim", metadata));
				}
			}
		}

		if (this.warnings > 0) {
			lines.push(
				truncateToWidth(
					this.theme.fg("warning", `Skipped, partially read, or repaired ${this.warnings} index/session file(s)`),
					width,
					"…",
				),
			);
		}
		lines.push(
			truncateToWidth(
				this.theme.fg(
					"dim",
					"type to search · Alt+R/↓ next · ↑ previous · → expand · ← collapse · Enter restore · Esc cancel",
				),
				width,
				"…",
			),
		);
		return lines;
	}

	private renderExpandedPrompt(prompt: PromptRecord, width: number): string[] {
		const contentWidth = Math.max(1, width - 4);
		const renderedText = highlightedPromptText(prompt.text, this.input.getValue(), this.theme);
		const wrapped = wrapTextWithAnsi(renderedText, contentWidth);
		const lines = [this.theme.fg("borderMuted", `  ${"─".repeat(Math.max(0, width - 2))}`)];

		for (const line of wrapped) {
			lines.push(truncateToWidth(`${this.theme.fg("borderMuted", "  │ ")}${line}`, width, ""));
		}

		lines.push(this.theme.fg("borderMuted", `  ${"─".repeat(Math.max(0, width - 2))}`));
		return lines;
	}

	private filterPrompts(): PromptRecord[] {
		const query = this.input.getValue();
		if (queryTokens(query).length === 0) return this.prompts;

		return this.prompts
			.map((prompt) => ({ prompt, score: promptMatchScore(prompt, query) }))
			.filter((result): result is { prompt: PromptRecord; score: number } => result.score !== null)
			.sort((a, b) => a.score - b.score || b.prompt.timestamp - a.prompt.timestamp)
			.map((result) => result.prompt);
	}

	private moveSelection(delta: number): void {
		if (this.filtered.length === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length;
		this.expandedSelected = false;
		this.tui.requestRender();
	}
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
		index = await loadPromptIndexForSearch(() => {
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

	const selected = await ctx.ui.custom<string | null>((tui, theme, keybindings, done) => {
		return new PromptHistorySearchComponent(
			tui,
			theme,
			keybindings,
			index.prompts,
			initialQuery ?? originalDraft,
			index.warnings,
			done,
		);
	});

	if (selected !== null && selected !== undefined) {
		ctx.ui.setEditorText(selected);
	}
}

export default function promptHistorySearchExtension(pi: ExtensionAPI): void {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension" || !shouldIndexInputText(event.text)) return { action: "continue" as const };

		try {
			await appendPromptToPersistedIndex({
				text: event.text.trim(),
				timestamp: Date.now(),
				sessionPath: ctx.sessionManager.getSessionFile() ?? "",
				sessionName: ctx.sessionManager.getSessionName(),
				cwd: ctx.cwd,
			});
		} catch (error) {
			if (ctx.hasUI) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not persist prompt history: ${message}`, "warning");
			}
		}

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
