import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
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

type ToolCallInfo = {
	name: string;
	arguments: Record<string, unknown>;
};

type ToolOutputRecord = {
	entryId: string;
	sequence: number;
	toolCallId: string;
	toolName: string;
	arguments?: Record<string, unknown>;
	content: unknown[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
	output: string;
	searchText: string;
};

type DetailView = "output" | "arguments" | "details";

const DETAIL_VIEWS: DetailView[] = ["output", "arguments", "details"];
const OVERLAY_HEIGHT_RATIO = 0.85;

function safeJson(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function normalizeSingleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function contentToText(content: unknown): string {
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const candidate = block as { type?: unknown; text?: unknown; mimeType?: unknown };
		if (candidate.type === "text" && typeof candidate.text === "string") {
			parts.push(candidate.text);
		} else if (candidate.type === "image") {
			const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "unknown type";
			parts.push(`[Image output: ${mimeType}]`);
		}
	}
	return parts.join("\n");
}

function timestampFrom(entry: { timestamp?: unknown }, message: { timestamp?: unknown }): number {
	if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
	if (typeof entry.timestamp === "string") {
		const parsed = Date.parse(entry.timestamp);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

function collectToolOutputs(ctx: ExtensionContext): ToolOutputRecord[] {
	const calls = new Map<string, ToolCallInfo>();
	const records: ToolOutputRecord[] = [];

	for (const rawEntry of ctx.sessionManager.getBranch()) {
		if (!rawEntry || typeof rawEntry !== "object" || rawEntry.type !== "message") continue;
		const entry = rawEntry as typeof rawEntry & { message?: unknown };
		const message = entry.message;
		if (!message || typeof message !== "object" || !("role" in message)) continue;

		if (message.role === "assistant" && "content" in message && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (!block || typeof block !== "object") continue;
				const call = block as {
					type?: unknown;
					id?: unknown;
					name?: unknown;
					arguments?: unknown;
				};
				if (call.type !== "toolCall" || typeof call.id !== "string" || typeof call.name !== "string") continue;
				calls.set(call.id, {
					name: call.name,
					arguments:
						call.arguments && typeof call.arguments === "object"
							? (call.arguments as Record<string, unknown>)
							: {},
				});
			}
			continue;
		}

		if (message.role !== "toolResult") continue;
		const result = message as {
			toolCallId?: unknown;
			toolName?: unknown;
			content?: unknown;
			details?: unknown;
			isError?: unknown;
			timestamp?: unknown;
		};
		if (typeof result.toolCallId !== "string") continue;

		const call = calls.get(result.toolCallId);
		const toolName = typeof result.toolName === "string" ? result.toolName : (call?.name ?? "tool");
		const content = Array.isArray(result.content) ? result.content : [];
		const output = contentToText(content);
		const sequence = records.length + 1;
		const argumentsText = safeJson(call?.arguments);
		const detailsText = safeJson(result.details);

		records.push({
			entryId: rawEntry.id,
			sequence,
			toolCallId: result.toolCallId,
			toolName,
			arguments: call?.arguments,
			content,
			details: result.details,
			isError: result.isError === true,
			timestamp: timestampFrom(rawEntry, result),
			output,
			searchText: `${toolName}\n${argumentsText}\n${output}\n${detailsText}`.toLowerCase(),
		});
	}

	return records.reverse();
}

function argumentsPreview(record: ToolOutputRecord): string {
	if (!record.arguments) return "";
	return normalizeSingleLine(safeJson(record.arguments));
}

function formatTimestamp(timestamp: number): string {
	if (!timestamp) return "unknown time";
	return new Date(timestamp).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

class ToolOutputBrowser implements Component, Focusable {
	private readonly input = new Input();
	private filtered: ToolOutputRecord[];
	private selectedIndex = 0;
	private mode: "list" | "detail" = "list";
	private detailView: DetailView = "output";
	private scrollOffset = 0;
	private cachedDetail?: { recordId: string; view: DetailView; width: number; lines: string[] };
	private _focused = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly records: ToolOutputRecord[],
		initialQuery: string,
		private readonly done: () => void,
	) {
		this.input.setValue(initialQuery.trim());
		this.filtered = this.filterRecords();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value && this.mode === "list";
	}

	invalidate(): void {
		this.input.invalidate();
		this.cachedDetail = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done();
			return;
		}

		if (this.mode === "detail") {
			this.handleDetailInput(data);
		} else {
			this.handleListInput(data);
		}
	}

	render(width: number): string[] {
		return this.mode === "detail" ? this.renderDetail(width) : this.renderList(width);
	}

	private handleListInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done();
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
			this.moveSelection(-this.listPageSize());
			return;
		}
		if (this.keybindings.matches(data, "tui.select.pageDown")) {
			this.moveSelection(this.listPageSize());
			return;
		}
		if (this.keybindings.matches(data, "tui.select.confirm")) {
			if (this.filtered[this.selectedIndex]) {
				this.mode = "detail";
				this.detailView = "output";
				this.scrollOffset = 0;
				this.input.focused = false;
				this.cachedDetail = undefined;
				this.tui.requestRender();
			}
			return;
		}

		const before = this.input.getValue();
		this.input.handleInput(data);
		if (this.input.getValue() !== before) {
			this.filtered = this.filterRecords();
			this.selectedIndex = 0;
		}
		this.tui.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
			this.mode = "list";
			this.input.focused = this._focused;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.cycleView(1);
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			this.cycleView(-1);
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			this.scrollBy(-1);
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			this.scrollBy(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.scrollBy(-this.detailPageSize());
			return;
		}
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.space)) {
			this.scrollBy(this.detailPageSize());
			return;
		}
		if (matchesKey(data, Key.home) || matchesKey(data, "g")) {
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.end) || data === "G") {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "n")) {
			this.moveDetailSelection(1);
			return;
		}
		if (matchesKey(data, "p")) {
			this.moveDetailSelection(-1);
		}
	}

	private renderList(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const pageSize = this.listPageSize();
		const lines: string[] = [];
		const border = (text: string) => this.theme.fg("border", text);
		const row = (content: string, selected = false) => {
			const fitted = truncateToWidth(content, innerWidth, "…", true);
			const body = selected ? this.theme.bg("selectedBg", fitted) : fitted;
			return border("│") + body + border("│");
		};

		lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold("Tool Output Browser"))} ${this.theme.fg("dim", `(${this.filtered.length}/${this.records.length})`)}`));

		const prefix = this.theme.fg("muted", " filter: ");
		const inputWidth = Math.max(1, innerWidth - visibleWidth(prefix));
		lines.push(row(prefix + (this.input.render(inputWidth)[0] ?? "")));
		lines.push(border(`├${"─".repeat(innerWidth)}┤`));

		if (this.filtered.length === 0) {
			lines.push(row(` ${this.theme.fg("warning", "No matching tool outputs")}`));
		} else {
			const start = Math.max(
				0,
				Math.min(this.selectedIndex - Math.floor(pageSize / 2), this.filtered.length - pageSize),
			);
			const end = Math.min(start + pageSize, this.filtered.length);
			for (let index = start; index < end; index++) {
				const record = this.filtered[index]!;
				const selected = index === this.selectedIndex;
				const marker = selected ? " ›" : "  ";
				const status = record.isError
					? this.theme.fg("error", "✗")
					: this.theme.fg("success", "✓");
				const name = this.theme.fg(selected ? "accent" : "toolTitle", record.toolName);
				const preview = argumentsPreview(record);
				const metadata = this.theme.fg("dim", `${formatTimestamp(record.timestamp)} · ${record.output.split("\n").length} lines`);
				lines.push(row(`${marker} ${status} #${record.sequence} ${name}${preview ? `  ${preview}` : ""}  ${metadata}`, selected));
			}
		}

		lines.push(border(`├${"─".repeat(innerWidth)}┤`));
		lines.push(row(` ${this.theme.fg("dim", "type to filter · ↑↓/PgUp/PgDn navigate · Enter open · Esc close")}`));
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	private renderDetail(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const contentWidth = Math.max(1, innerWidth - 2);
		const record = this.filtered[this.selectedIndex];
		if (!record) {
			this.mode = "list";
			return this.renderList(width);
		}

		const lines: string[] = [];
		const border = (text: string) => this.theme.fg(record.isError ? "error" : "border", text);
		const row = (content: string) => border("│") + truncateToWidth(content, innerWidth, "…", true) + border("│");
		const contentRow = (content: string) => row(` ${content}`);

		lines.push(border(`╭${"─".repeat(innerWidth)}╮`));
		const status = record.isError ? this.theme.fg("error", "error") : this.theme.fg("success", "success");
		lines.push(row(` ${this.theme.fg("accent", this.theme.bold(`#${record.sequence} ${record.toolName}`))} · ${status}`));
		lines.push(row(` ${this.theme.fg("dim", `${formatTimestamp(record.timestamp)} · call ${record.toolCallId} · entry ${record.entryId}`)}`));

		const tabs = DETAIL_VIEWS.map((view) =>
			view === this.detailView
				? this.theme.fg("accent", this.theme.bold(`[${view}]`))
				: this.theme.fg("dim", view),
		).join("  ");
		lines.push(row(` ${tabs}`));
		lines.push(border(`├${"─".repeat(innerWidth)}┤`));

		const wrapped = this.detailLines(record, contentWidth);
		const pageSize = this.detailPageSize();
		const maxOffset = Math.max(0, wrapped.length - pageSize);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const visible = wrapped.slice(this.scrollOffset, this.scrollOffset + pageSize);
		for (const line of visible) lines.push(contentRow(this.theme.fg("toolOutput", line)));
		for (let index = visible.length; index < pageSize; index++) lines.push(contentRow(""));

		lines.push(border(`├${"─".repeat(innerWidth)}┤`));
		const position = wrapped.length === 0
			? "0/0"
			: `${this.scrollOffset + 1}-${Math.min(this.scrollOffset + pageSize, wrapped.length)}/${wrapped.length}`;
		lines.push(row(` ${this.theme.fg("dim", `${position} · ↑↓/j k scroll · PgUp/PgDn page · Tab/→ view · n/p result · Esc/← back · Ctrl+C close`)}`));
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	private detailLines(record: ToolOutputRecord, width: number): string[] {
		if (
			this.cachedDetail?.recordId === record.entryId &&
			this.cachedDetail.view === this.detailView &&
			this.cachedDetail.width === width
		) {
			return this.cachedDetail.lines;
		}

		let text: string;
		switch (this.detailView) {
			case "arguments":
				text = safeJson(record.arguments) || "(arguments unavailable)";
				break;
			case "details":
				text = safeJson(record.details) || "(no details)";
				break;
			default:
				text = record.output || "(no text output)";
		}

		const lines = wrapTextWithAnsi(text, width);
		this.cachedDetail = { recordId: record.entryId, view: this.detailView, width, lines };
		return lines;
	}

	private filterRecords(): ToolOutputRecord[] {
		const terms = normalizeSingleLine(this.input.getValue()).toLowerCase().split(" ").filter(Boolean);
		if (terms.length === 0) return [...this.records];
		return this.records.filter((record) => terms.every((term) => record.searchText.includes(term)));
	}

	private listPageSize(): number {
		return Math.max(1, this.overlayHeight() - 7);
	}

	private detailPageSize(): number {
		return Math.max(1, this.overlayHeight() - 8);
	}

	private overlayHeight(): number {
		return Math.max(9, Math.floor(this.tui.terminal.rows * OVERLAY_HEIGHT_RATIO));
	}

	private moveSelection(delta: number): void {
		if (this.filtered.length === 0) return;
		this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length;
		this.tui.requestRender();
	}

	private moveDetailSelection(delta: number): void {
		this.moveSelection(delta);
		this.scrollOffset = 0;
		this.cachedDetail = undefined;
	}

	private cycleView(delta: number): void {
		const index = DETAIL_VIEWS.indexOf(this.detailView);
		this.detailView = DETAIL_VIEWS[(index + delta + DETAIL_VIEWS.length) % DETAIL_VIEWS.length]!;
		this.scrollOffset = 0;
		this.cachedDetail = undefined;
		this.tui.requestRender();
	}

	private scrollBy(delta: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset + delta);
		this.tui.requestRender();
	}
}

async function openToolOutputBrowser(ctx: ExtensionContext, initialQuery = ""): Promise<void> {
	if (ctx.mode !== "tui") {
		if (ctx.hasUI) ctx.ui.notify("Tool output browser is available only in interactive TUI mode", "warning");
		return;
	}

	const records = collectToolOutputs(ctx);
	if (records.length === 0) {
		ctx.ui.notify("No tool outputs on the active session branch", "info");
		return;
	}

	await ctx.ui.custom<void>(
		(tui, theme, keybindings, done) =>
			new ToolOutputBrowser(tui, theme, keybindings, records, initialQuery, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				minWidth: 50,
				maxHeight: "85%",
			},
		},
	);
}

export default function toolOutputBrowserExtension(pi: ExtensionAPI): void {
	pi.registerCommand("tool-output", {
		description: "Browse and open individual tool outputs",
		handler: async (args, ctx) => openToolOutputBrowser(ctx, args),
	});
}
