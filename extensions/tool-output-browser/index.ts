import {
	copyToClipboard,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	type Component,
	type Focusable,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { createPicker, type FilterGroup, type Picker } from "@stagefright5/pi-picker";

import { browserFrame } from "./browser-layout.ts";

type ToolCallInfo = {
	name: string;
	arguments: Record<string, unknown>;
};

export type ToolOutputRecord = {
	entryId: string;
	sequence: number;
	toolCallId: string;
	toolName: string;
	arguments?: Record<string, unknown>;
	content: unknown[];
	details?: unknown;
	structuredContent?: unknown;
	nestedCalls?: unknown;
	isError: boolean;
	timestamp: number;
	output: string;
	searchText: string;
};

type DetailView = "output" | "arguments" | "details" | "structured" | "nested";

const DETAIL_VIEWS: DetailView[] = ["output", "arguments", "details", "structured", "nested"];
const OVERLAY_HEIGHT_RATIO = 0.85;

function safeJson(value: unknown): string {
	if (value === undefined) return "";
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Index repeated payload strings once; preserve the original objects for the detail tabs. */
function searchText(toolName: string, output: string, ...values: unknown[]): string {
	const seen = new Set([toolName, output]);
	const parts = [toolName, output];
	for (const value of values) {
		try {
			parts.push(
				JSON.stringify(value, (_key, item: unknown) => {
					if (typeof item !== "string") return item;
					// A bash text result can contain its structured output plus a truncation/status notice.
					if (seen.has(item) || (item.length >= 256 && output.includes(item))) return "";
					seen.add(item);
					return item;
				}) ?? "",
			);
		} catch {
			parts.push(String(value));
		}
	}
	return parts.join("\n").toLowerCase();
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

export function collectToolOutputs(ctx: ExtensionContext): ToolOutputRecord[] {
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
			structuredContent?: unknown;
			nestedCalls?: unknown;
			isError?: unknown;
			timestamp?: unknown;
		};
		if (typeof result.toolCallId !== "string") continue;

		const call = calls.get(result.toolCallId);
		const toolName = typeof result.toolName === "string" ? result.toolName : (call?.name ?? "tool");
		const content = Array.isArray(result.content) ? result.content : [];
		const output = contentToText(content);
		const sequence = records.length + 1;

		records.push({
			entryId: rawEntry.id,
			sequence,
			toolCallId: result.toolCallId,
			toolName,
			arguments: call?.arguments,
			content,
			details: result.details,
			structuredContent: result.structuredContent,
			nestedCalls: result.nestedCalls,
			isError: result.isError === true,
			timestamp: timestampFrom(rawEntry, result),
			output,
			searchText: searchText(
				toolName,
				output,
				call?.arguments,
				result.details,
				result.structuredContent,
				result.nestedCalls,
			),
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

/** Tool names offered as filter chips (most frequent first). */
const MAX_TOOL_FILTERS = 6;

export class ToolOutputBrowser implements Component, Focusable {
	private readonly picker: Picker<ToolOutputRecord>;
	private filtered: ToolOutputRecord[] = [];
	private selectedIndex = 0;
	private mode: "list" | "detail" = "list";
	private detailView: DetailView = "output";
	private scrollOffset = 0;
	private cachedDetail?: { recordId: string; view: DetailView; width: number; lines: string[] };
	private _focused = false;
	private readonly keybindings: KeybindingsManager;

	private readonly tui: TUI;
	private readonly getTheme: () => Theme;
	private readonly done: () => void;

	constructor(
		tui: TUI,
		getTheme: () => Theme,
		keybindings: KeybindingsManager,
		records: ToolOutputRecord[],
		initialQuery: string,
		done: () => void,
		copy: (text: string) => Promise<void> = copyToClipboard,
	) {
		this.keybindings = keybindings;
		this.tui = tui;
		this.getTheme = getTheme;
		this.done = done;
		const counts = new Map<string, number>();
		for (const record of records) counts.set(record.toolName, (counts.get(record.toolName) ?? 0) + 1);
		const tools = [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, MAX_TOOL_FILTERS)
			.map(([name]) => name);
		const filters: FilterGroup<ToolOutputRecord>[] = [
			{
				id: "tool",
				label: "Tool",
				options: tools.map((name) => ({ id: name, label: name, test: (record) => record.toolName === name })),
			},
			{
				id: "status",
				label: "Status",
				options: [{ id: "errors", label: "errors only", test: (record) => record.isError }],
			},
		];
		this.picker = createPicker<ToolOutputRecord>({
			tui,
			theme: getTheme,
			keybindings,
			title: "Tool output",
			items: records,
			text: (record) => record.searchText,
			// Name column stays readable; arguments fill the description column.
			row: (record) => ({
				primary: `${record.isError ? "✗" : "✓"} #${record.sequence} ${record.toolName}`,
				secondary: argumentsPreview(record),
			}),
			layout: "column",
			preview: (record) =>
				`${formatTimestamp(record.timestamp)} · ${record.output.split("\n").length} lines${record.isError ? " · error" : ""}\n\n${record.output || "(no text output)"}`,
			filters,
			multiSelect: true,
			initialQuery: initialQuery.trim(),
			emptyMessage: "No matching tool outputs",
			height: () => this.overlayHeight(),
			actions: [
				{
					id: "open",
					label: "open",
					key: "tui.select.confirm",
					primary: true,
					run: (items) => this.openDetail(items),
				},
				{
					id: "copy",
					label: "copy",
					key: "ctrl+y",
					run: async (items, context) => {
						await copy(items.map((record) => record.output).join("\n\n"));
						context.notify(items.length === 1 ? "Copied output" : `Copied ${items.length} outputs`);
					},
				},
			],
			onClose: () => this.done(),
		});
	}

	private get theme(): Theme {
		return this.getTheme();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.picker.focused = value && this.mode === "list";
	}

	invalidate(): void {
		this.picker.invalidate();
		this.cachedDetail = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done();
			return;
		}

		if (this.mode === "detail") this.handleDetailInput(data);
		else this.picker.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.mode === "list" ? this.picker.handleMouse(event) : undefined;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (this.mode === "list") return this.picker.render(width);
		return this.renderDetail(width).map((line) => truncateToWidth(line, width, "…"));
	}

	/** Open the detail view; with several marked results, n/p steps through just those. */
	private openDetail(items: readonly ToolOutputRecord[]): void {
		const selected = this.picker.selectedItem;
		this.filtered = items.length > 1 ? [...items] : this.picker.results;
		const start = items.length > 1 ? 0 : this.filtered.indexOf(selected ?? items[0]!);
		this.selectedIndex = Math.max(0, start);
		this.mode = "detail";
		this.detailView = "output";
		this.scrollOffset = 0;
		this.picker.focused = false;
		this.cachedDetail = undefined;
		this.tui.requestRender();
	}

	private handleDetailInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.left)) {
			this.mode = "list";
			this.picker.focused = this._focused;
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
		if (this.keybindings.matches(data, "tui.select.up") || matchesKey(data, "k")) {
			this.scrollBy(-1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.down") || matchesKey(data, "j")) {
			this.scrollBy(1);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.pageUp")) {
			this.scrollBy(-this.detailPageSize());
			return;
		}
		if (this.keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, Key.space)) {
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

	private renderDetail(width: number): string[] {
		const contentWidth = Math.max(1, width - 1);
		const record = this.filtered[this.selectedIndex];
		if (!record) {
			this.mode = "list";
			return this.picker.render(width);
		}

		const lines: string[] = [];
		const { row, rule } = browserFrame(width, this.theme, record.isError);
		const contentRow = (content: string) => row(` ${content}`);

		lines.push(rule());
		const status = record.isError ? this.theme.fg("error", "error") : this.theme.fg("success", "success");
		lines.push(
			row(` ${this.theme.fg("accent", this.theme.bold(`#${record.sequence} ${record.toolName}`))} · ${status}`),
		);
		lines.push(
			row(
				` ${this.theme.fg("dim", `${formatTimestamp(record.timestamp)} · call ${record.toolCallId} · entry ${record.entryId}`)}`,
			),
		);

		const tabs = DETAIL_VIEWS.map((view) =>
			view === this.detailView ? this.theme.fg("accent", this.theme.underline(view)) : this.theme.fg("dim", view),
		).join("  ");
		lines.push(row(` ${tabs}`));
		lines.push(rule());

		const wrapped = this.detailLines(record, contentWidth);
		const pageSize = this.detailPageSize();
		const maxOffset = Math.max(0, wrapped.length - pageSize);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const visible = wrapped.slice(this.scrollOffset, this.scrollOffset + pageSize);
		for (const line of visible) lines.push(contentRow(this.theme.fg("toolOutput", line)));
		for (let index = visible.length; index < pageSize; index++) lines.push(contentRow(""));

		lines.push(rule());
		const position =
			wrapped.length === 0
				? "0/0"
				: `${this.scrollOffset + 1}-${Math.min(this.scrollOffset + pageSize, wrapped.length)}/${wrapped.length}`;
		const back = this.keybindings.getKeys("tui.select.cancel").join("/");
		const scroll = [
			...this.keybindings.getKeys("tui.select.up"),
			...this.keybindings.getKeys("tui.select.down"),
		].join("/");
		lines.push(
			row(
				` ${this.theme.fg("dim", width < 80 ? `${position} · tab view · ${back} back` : `${position} · ${scroll} scroll · tab view · n/p result · ${back} back · ctrl+c close`)}`,
			),
		);
		lines.push(rule());
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
			case "structured":
				text = safeJson(record.structuredContent) || "(no structured content)";
				break;
			case "nested":
				text = safeJson(record.nestedCalls) || "(no nested calls)";
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
		(tui, _theme, keybindings, done) =>
			new ToolOutputBrowser(tui, () => ctx.ui.theme, keybindings, records, initialQuery, done),
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
