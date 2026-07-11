import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename } from "node:path";
import {
	parseSessionEntries,
	SessionManager,
	type ExtensionAPI,
	type ExtensionContext,
	type FileEntry,
	type KeybindingsManager,
	type SessionInfo,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	fuzzyMatch,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
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

const MAX_VISIBLE = 8;
const sessionCache = new Map<string, CachedSession>();

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

function promptsFromEntries(entries: FileEntry[], session: SessionInfo): PromptRecord[] {
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

async function loadSessionPrompts(session: SessionInfo): Promise<CachedSession> {
	const content = await readFile(session.path, "utf8");
	const nonEmptyLineCount = content.split("\n").filter((line) => line.trim().length > 0).length;
	const entries = parseSessionEntries(content);

	return {
		modifiedMs: session.modified.getTime(),
		prompts: promptsFromEntries(entries, session),
		malformed: entries.length !== nonEmptyLineCount,
	};
}

async function buildPromptIndex(): Promise<PromptIndex> {
	const sessions = await SessionManager.listAll();
	const activePaths = new Set(sessions.map((session) => session.path));
	let warnings = 0;

	for (const path of sessionCache.keys()) {
		if (!activePaths.has(path)) sessionCache.delete(path);
	}

	const perSession = await Promise.all(
		sessions.map(async (session): Promise<PromptRecord[]> => {
			const modifiedMs = session.modified.getTime();
			const cached = sessionCache.get(session.path);
			if (cached?.modifiedMs === modifiedMs) {
				if (cached.malformed) warnings++;
				return cached.prompts;
			}

			try {
				const loaded = await loadSessionPrompts(session);
				sessionCache.set(session.path, loaded);
				if (loaded.malformed) warnings++;
				return loaded.prompts;
			} catch {
				warnings++;
				sessionCache.delete(session.path);
				return [];
			}
		}),
	);

	return {
		prompts: perSession.flat().sort((a, b) => b.timestamp - a.timestamp),
		warnings,
	};
}

function normalizeSingleLine(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function promptMatches(prompt: PromptRecord, query: string): boolean {
	const normalizedQuery = normalizeSingleLine(query);
	if (!normalizedQuery) return true;

	const searchable = `${normalizeSingleLine(prompt.text)} ${prompt.sessionName ?? ""} ${prompt.cwd}`;
	const lowered = searchable.toLowerCase();
	const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

	return tokens.every((token) => lowered.includes(token.toLowerCase()) || fuzzyMatch(token, searchable).matches);
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

class PromptHistorySearchComponent implements Component, Focusable {
	private readonly input = new Input();
	private filtered: PromptRecord[];
	private selectedIndex = 0;
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
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const title = `Global Prompt History (${this.filtered.length}/${this.prompts.length})`;
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
				const preview = truncateToWidth(prefix + normalizeSingleLine(prompt.text), width, "…");
				const sessionFile = basename(prompt.sessionPath, ".jsonl");
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
				} else {
					lines.push(preview);
					lines.push(this.theme.fg("dim", metadata));
				}
			}
		}

		if (this.warnings > 0) {
			lines.push(
				truncateToWidth(
					this.theme.fg("warning", `Skipped or partially read ${this.warnings} session file(s)`),
					width,
					"…",
				),
			);
		}
		lines.push(
			truncateToWidth(
				this.theme.fg("dim", "type to search · Alt+R/↓ older · ↑ newer · Enter restore · Esc cancel"),
				width,
				"…",
			),
		);
		return lines;
	}

	private filterPrompts(): PromptRecord[] {
		return this.prompts.filter((prompt) => promptMatches(prompt, this.input.getValue()));
	}

	private moveSelection(delta: number): void {
		if (this.filtered.length === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length;
		this.tui.requestRender();
	}
}

async function openPromptHistory(ctx: ExtensionContext, initialQuery?: string): Promise<void> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify("Global prompt history is available only in interactive TUI mode", "warning");
		return;
	}

	const originalDraft = ctx.ui.getEditorText();
	let index: PromptIndex;
	ctx.ui.setStatus("prompt-history-search", "Indexing prompt history…");
	try {
		index = await buildPromptIndex();
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
	pi.registerShortcut("alt+r", {
		description: "Reverse-search prompts across all sessions",
		handler: async (ctx) => openPromptHistory(ctx),
	});

	pi.registerCommand("prompt-history", {
		description: "Search user prompts across all saved sessions",
		handler: async (args, ctx) => openPromptHistory(ctx, args.trim()),
	});
}
