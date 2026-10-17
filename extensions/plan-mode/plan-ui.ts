import {
	BorderedLoader,
	copyToClipboard,
	ExtensionEditorComponent,
	getMarkdownTheme,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { keyLabel, paintRow, paletteFromTheme, type Palette } from "@stagefright5/pi-picker";
import { homedir } from "node:os";
import {
	Key,
	Markdown,
	matchesKey,
	ScrollView,
	sliceByColumn,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type KeyId,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

export type ReviewAction = "approve" | "revise" | "cancel" | "diff" | "summary" | "allSummary" | "qa";
export interface DocumentAction {
	key: KeyId;
	label: string;
	value: ReviewAction;
	/** Drawn as the one emphasised action. */
	primary?: boolean;
}
export interface DocumentOptions {
	/** What the view is, e.g. "Plan review"; drawn in the accent colour before the title. */
	kind?: string;
	title: string;
	/** Right side of the header, e.g. "iteration 2". */
	meta?: string;
	subtitle?: string;
	content: string;
	format?: "markdown" | "diff";
	actions?: readonly DocumentAction[];
}
export interface DocumentHost {
	rows(): number;
	theme(): Theme;
	requestRender(): void;
	keybindings: Pick<KeybindingsManager, "matches">;
	copy(text: string): Promise<void>;
}

type Point = { line: number; col: number };
const singleLine = (text: string) => stripTerminalSequences(text).replace(/[\r\n\t]/g, " ");
const tildePath = (text: string) => {
	const home = homedir();
	return home && text.startsWith(home + "/") ? "~" + text.slice(home.length) : text;
};
/** Left text and right text on one row; the right side wins when space runs out. */
function spread(left: string, right: string, width: number): string {
	const room = width - visibleWidth(right);
	if (room < 2) return truncateToWidth(right, width, "");
	const head = truncateToWidth(left, room - 1, "…");
	return head + " ".repeat(Math.max(1, room - visibleWidth(head))) + right;
}

/** Markdown owns parsing/highlighting; cached ANSI is discarded on theme invalidation. */
class DocumentBody implements Component {
	private readonly markdown: Markdown;
	private cache?: { width: number; lines: string[] };

	private readonly options: DocumentOptions;
	private readonly getTheme: () => Theme;

	constructor(options: DocumentOptions, getTheme: () => Theme) {
		this.options = options;
		this.getTheme = getTheme;
		this.markdown = new Markdown(options.content, 0, 0, getMarkdownTheme());
	}

	invalidate(): void {
		this.cache = undefined;
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (this.cache?.width === width) return this.cache.lines;
		const theme = this.getTheme();
		const lines =
			this.options.format === "diff"
				? this.options.content.split("\n").flatMap((line) => {
						const color =
							line.startsWith("+++") || line.startsWith("---")
								? "muted"
								: line.startsWith("+")
									? "toolDiffAdded"
									: line.startsWith("-")
										? "toolDiffRemoved"
										: line.startsWith("@@")
											? "accent"
											: "text";
						return wrapTextWithAnsi(theme.fg(color, line), width);
					})
				: this.markdown.render(width);
		this.cache = { width, lines: lines.map((line) => truncateToWidth(line, width, "")) };
		return this.cache.lines;
	}
}

/**
 * One bounded viewer for review, diff, summary and Q&A. ScrollView owns scroll
 * bounds/state; this adapter slices its content for both regular-mode custom UI
 * and overlays (the public Component API has no height argument).
 * Mouse coordinates are already local: never parse SGR or change terminal modes.
 */
export class PlanDocumentView implements Component {
	private readonly body: DocumentBody;
	private readonly scroll: ScrollView;
	private bodyLines: string[] = [];
	private bodyTop = 0;
	private bodyHeight = 1;
	private width = 0;
	private padLeft = 0;
	private actionRow = -1;
	private actionTargets: Array<{ from: number; to: number; value: ReviewAction | "copy" }> = [];
	private anchor?: Point;
	private focus?: Point;
	private selecting = false;
	private closed = false;
	private copySequence = 0;
	private status = "";

	private readonly options: DocumentOptions;
	private readonly host: DocumentHost;
	private readonly done: (action: ReviewAction) => void;
	private readonly onDispose: () => void;

	constructor(
		options: DocumentOptions,
		host: DocumentHost,
		done: (action: ReviewAction) => void,
		onDispose: () => void = () => {},
	) {
		this.options = options;
		this.host = host;
		this.done = done;
		this.onDispose = onDispose;
		this.body = new DocumentBody(options, () => host.theme());
		this.scroll = new ScrollView(this.body, { overscroll: "contain", scrollbar: "hidden" });
	}

	invalidate(): void {
		this.body.invalidate();
		this.anchor = this.focus = undefined;
		this.selecting = false;
	}

	dispose(): void {
		if (this.closed) return;
		this.closed = true;
		this.copySequence++;
		this.onDispose();
	}

	close(action: ReviewAction = "cancel"): void {
		if (this.closed) return;
		this.dispose();
		this.done(action);
	}

	render(width: number): string[] {
		if (width <= 0 || this.closed) return [];
		if (this.width !== width) {
			this.anchor = this.focus = undefined;
			this.selecting = false;
		}
		this.width = width;
		const theme = this.host.theme();
		const palette = paletteFromTheme(theme);
		const height = Math.max(1, Math.floor(this.host.rows() * 0.9));
		const compact = height < 8;
		// One panel colour for the whole card, as in the pi-picker overlays. It is darker than the
		// composer surface, so the card never merges with the composer bar below it; thin rules
		// separate the header and the footer from the document.
		const sheet = (line: string) => paintRow(truncateToWidth(line, width, ""), width, palette.text, palette.panel);
		this.padLeft = width >= 40 ? 3 : width >= 12 ? 1 : 0;
		const padRight = width >= 40 ? 3 : width >= 12 ? 1 : 0;
		const inner = Math.max(1, width - this.padLeft - padRight);
		const gutter = " ".repeat(this.padLeft);

		const headerHeight = compact ? (height > 1 ? 1 : 0) : 3;
		const footerHeight = compact ? (height > 2 ? 1 : 0) : 2;
		this.bodyTop = headerHeight;
		this.bodyHeight = Math.max(1, height - headerHeight - footerHeight);
		this.bodyLines = this.scroll.render(inner);
		this.scroll.updateLayout(this.bodyLines.length, this.bodyHeight, () => {
			if (!this.closed) this.host.requestRender();
		});
		const total = this.bodyLines.length;
		const top = this.scroll.scrollTop;
		const overflow = total > this.bodyHeight;

		const kind = this.options.kind ? palette.fg("accent", palette.bold(singleLine(this.options.kind))) : "";
		const title = palette.bold(singleLine(this.options.title));
		const heading = kind && this.options.title ? `${kind}  ${title}` : kind || title;
		const position = overflow
			? top === 0
				? "top"
				: top + this.bodyHeight >= total
					? "end"
					: `${Math.round((top / Math.max(1, total - this.bodyHeight)) * 100)}%`
			: "";
		const meta = [this.options.meta ? singleLine(this.options.meta) : "", position].filter(Boolean).join(" · ");
		const titleRow = gutter + spread(heading, palette.fg("dim", meta), inner);
		const rule = sheet(gutter + theme.fg("borderMuted", "─".repeat(inner)));
		const header = compact
			? headerHeight
				? [sheet(titleRow)]
				: []
			: [
					sheet(titleRow),
					sheet(gutter + palette.fg("dim", tildePath(singleLine(this.options.subtitle ?? "")))),
					rule,
				];

		// A thin thumb in the right padding shows where the visible part sits in a long document.
		const thumbSize = overflow ? Math.max(1, Math.round((this.bodyHeight * this.bodyHeight) / total)) : 0;
		const thumbTop = overflow
			? Math.round((top / Math.max(1, total - this.bodyHeight)) * (this.bodyHeight - thumbSize))
			: 0;
		const body: string[] = [];
		for (let row = 0; row < this.bodyHeight; row++) {
			const line = this.bodyLines[top + row];
			const text = line === undefined ? "" : this.highlight(line, top + row);
			const thumb =
				overflow && padRight >= 2 && row >= thumbTop && row < thumbTop + thumbSize
					? palette.fg("dim", "┃")
					: "";
			const filled = gutter + text + " ".repeat(Math.max(0, inner - visibleWidth(text)));
			body.push(sheet(thumb ? filled + " ".repeat(Math.max(0, padRight - 2)) + thumb : filled));
		}

		const footerRow = this.renderFooter(palette, width);
		this.actionRow = compact ? -1 : headerHeight + this.bodyHeight + 1;
		const footer = compact ? (footerHeight ? [sheet(footerRow)] : []) : [rule, sheet(footerRow)];
		return [...header, ...body, ...footer].slice(0, height).map((line) => truncateToWidth(line, width, ""));
	}

	handleInput(data: string): void {
		if (this.closed) return;
		const kb = this.host.keybindings;
		if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.ctrl("c"))) return this.close();
		if (matchesKey(data, "c")) {
			this.copy(this.options.content, "Copied full document");
			return;
		}
		const action = this.options.actions?.find((item) => matchesKey(data, item.key));
		if (action) return this.close(action.value);
		if (kb.matches(data, "tui.select.up") || matchesKey(data, "k")) this.scroll.scrollBy(-1);
		else if (kb.matches(data, "tui.select.down") || matchesKey(data, "j")) this.scroll.scrollBy(1);
		else if (kb.matches(data, "tui.select.pageUp")) this.scroll.scrollBy(-this.bodyHeight);
		else if (kb.matches(data, "tui.select.pageDown") || matchesKey(data, Key.space))
			this.scroll.scrollBy(this.bodyHeight);
		else if (matchesKey(data, Key.home) || matchesKey(data, "g")) this.scroll.scrollToStart();
		else if (matchesKey(data, Key.end) || matchesKey(data, "shift+g")) this.scroll.scrollToEnd();
		else if (!this.options.actions?.length && kb.matches(data, "tui.select.confirm")) this.close();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.closed) return undefined;
		if (event.type === "wheel") {
			this.scroll.scrollBy(event.wheelDelta ?? 0);
			return { handled: true, render: true };
		}
		if (event.type === "press" && event.button === "left" && event.y === this.actionRow) return { handled: true };
		if (event.type === "click" && event.button === "left" && event.y === this.actionRow) {
			const target = this.actionTargets.find(
				(item) => event.x >= item.from && event.x < Math.min(item.to, this.width),
			);
			if (target?.value === "copy") this.copy(this.options.content, "Copied full document");
			else if (target) this.close(target.value);
			return { handled: true };
		}
		if (event.type === "press" && event.button === "left" && this.inBody(event.y) && this.bodyLines.length) {
			this.anchor = this.focus = this.point(event);
			this.selecting = true;
			return { capture: true, render: true };
		}
		if (this.selecting && (event.type === "drag" || event.type === "release")) {
			this.focus = this.point(event);
			if (event.type === "release") {
				this.selecting = false;
				const selected = this.selectedText();
				if (selected) this.copy(selected, "Copied selection");
			}
			return { handled: true, render: true };
		}
		return undefined;
	}

	/** Workflow actions on the left (the primary one as a chip), copy and close on the right. */
	private renderFooter(palette: Palette, width: number): string {
		this.actionTargets = [];
		const gutter = " ".repeat(this.padLeft);
		const room = Math.max(1, width - 2 * this.padLeft);
		const tail: Array<{ key: string; label: string; value: ReviewAction | "copy" }> = [
			{ key: "c", label: "copy", value: "copy" },
			{ key: "escape", label: "close", value: "cancel" },
		];
		// Plain letters stay lowercase: "A" would read as Shift+A.
		const keyText = (key: string) => (key.length === 1 ? key : keyLabel(key));
		const chip = (action: { key: string; label: string; primary?: boolean }) =>
			action.primary
				? paintRow(
						palette.fg("accent", palette.bold(` ${keyText(action.key)} ${action.label} `)),
						visibleWidth(` ${keyText(action.key)} ${action.label} `),
						"",
						palette.selected,
					)
				: palette.fg("muted", keyText(action.key)) + " " + palette.fg("dim", action.label);
		const join = (items: ReadonlyArray<{ key: string; label: string; primary?: boolean }>) =>
			items.map(chip).join("   ");
		const right = this.status
			? palette.fg(this.status.startsWith("Copy failed") ? "error" : "success", this.status)
			: join(tail);
		// Drop secondary actions from the end until the row fits; the primary one stays.
		const shown = [...(this.options.actions ?? [])];
		while (shown.length > 1 && visibleWidth(join(shown)) + 3 + visibleWidth(right) > room) {
			const last = shown.findLastIndex((action) => !action.primary);
			if (last < 0) break;
			shown.splice(last, 1);
		}
		const left = join(shown);
		let x = this.padLeft;
		for (const action of shown) {
			const cell = visibleWidth(chip(action));
			this.actionTargets.push({ from: x, to: x + cell, value: action.value });
			x += cell + 3;
		}
		if (!this.status) {
			let rx = this.padLeft + Math.max(visibleWidth(left) + 1, room - visibleWidth(right));
			for (const action of tail) {
				const cell = visibleWidth(chip(action));
				this.actionTargets.push({ from: rx, to: rx + cell, value: action.value });
				rx += cell + 3;
			}
		}
		return gutter + spread(left, right, room);
	}

	private inBody(y: number): boolean {
		return y >= this.bodyTop && y < this.bodyTop + this.bodyHeight;
	}

	private point(event: TuiMouseEvent): Point {
		const line = Math.min(
			this.bodyLines.length - 1,
			this.scroll.scrollTop + Math.max(0, Math.min(this.bodyHeight - 1, event.y - this.bodyTop)),
		);
		const col = event.x - this.padLeft;
		return { line, col: Math.max(0, Math.min(this.width, visibleWidth(this.bodyLines[line] ?? ""), col)) };
	}

	private selection(): { start: Point; end: Point } | undefined {
		if (!this.anchor || !this.focus) return undefined;
		const order = this.anchor.line - this.focus.line || this.anchor.col - this.focus.col;
		if (!order) return undefined;
		return order < 0 ? { start: this.anchor, end: this.focus } : { start: this.focus, end: this.anchor };
	}

	private selectedText(): string {
		const selected = this.selection();
		if (!selected) return "";
		const lines: string[] = [];
		for (let i = selected.start.line; i <= selected.end.line; i++) {
			const line = this.bodyLines[i] ?? "";
			const from = i === selected.start.line ? selected.start.col : 0;
			const to = i === selected.end.line ? selected.end.col : visibleWidth(line);
			lines.push(stripTerminalSequences(sliceByColumn(line, from, Math.max(0, to - from))).trimEnd());
		}
		return lines.join("\n");
	}

	private highlight(line: string, index: number): string {
		const selection = this.selection();
		if (!selection || index < selection.start.line || index > selection.end.line) return line;
		const from = index === selection.start.line ? selection.start.col : 0;
		const to = index === selection.end.line ? selection.end.col : visibleWidth(line);
		const theme = this.host.theme();
		return (
			sliceByColumn(line, 0, from) +
			theme.bg(
				"selectedBg",
				theme.fg("text", stripTerminalSequences(sliceByColumn(line, from, Math.max(0, to - from)))),
			) +
			sliceByColumn(line, to, Math.max(0, visibleWidth(line) - to))
		);
	}

	private copy(text: string, success: string): void {
		const sequence = ++this.copySequence;
		void this.host
			.copy(text)
			.then(
				() => success,
				(error: unknown) => `Copy failed: ${String(error)}`,
			)
			.then((status) => {
				if (this.closed || sequence !== this.copySequence) return;
				this.status = status;
				this.host.requestRender();
			});
	}
}

export async function showDocument(
	ctx: ExtensionContext,
	options: DocumentOptions,
	signal: AbortSignal,
): Promise<ReviewAction> {
	if (signal.aborted) return "cancel";
	return ctx.ui.custom<ReviewAction>(
		(tui, _theme, keybindings, done) => {
			const abort = () => view.close();
			const view = new PlanDocumentView(
				options,
				{
					rows: () => tui.terminal.rows,
					theme: () => ctx.ui.theme,
					requestRender: () => tui.requestRender(),
					keybindings,
					copy: async (text) => {
						await copyToClipboard(text);
					},
				},
				done,
				() => signal.removeEventListener("abort", abort),
			);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) view.close();
			return view;
		},
		{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } },
	);
}

/** The same native editor as ctx.ui.editor, with explicit workflow cancellation. */
export async function requestRevision(ctx: ExtensionContext, signal: AbortSignal): Promise<string | undefined> {
	if (signal.aborted) return undefined;
	return ctx.ui.custom<string | undefined>((tui, _theme, keybindings, done) => {
		let closed = false;
		const abort = () => finish(undefined);
		const finish = (value: string | undefined) => {
			if (closed) return;
			closed = true;
			signal.removeEventListener("abort", abort);
			done(value);
		};
		const editor = new ExtensionEditorComponent(
			tui,
			keybindings,
			"What changes would you like to the plan?",
			"",
			finish,
			abort,
		);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		return {
			get focused() {
				return editor.focused;
			},
			set focused(value: boolean) {
				editor.focused = value;
			},
			render: (width) => (width > 0 ? editor.render(width).map((line) => truncateToWidth(line, width, "")) : []),
			invalidate: () => editor.invalidate(),
			handleInput: (data) => editor.handleInput(data),
			handleMouse: (event) => editor.handleMouse(event),
			dispose() {
				closed = true;
				signal.removeEventListener("abort", abort);
			},
		};
	});
}

export async function withLoader<T>(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
	if (signal.aborted) return undefined;
	return ctx.ui.custom<T | undefined>((tui, theme, _kb, done) => {
		const disposed = new AbortController();
		const loader = new BorderedLoader(tui, theme, label);
		const combined = AbortSignal.any([signal, loader.signal, disposed.signal]);
		let finished = false;
		const finish = (value: T | undefined) => {
			if (finished) return;
			finished = true;
			combined.removeEventListener("abort", abort);
			done(value);
		};
		const abort = () => finish(undefined);
		combined.addEventListener("abort", abort, { once: true });
		if (combined.aborted) abort();
		void Promise.resolve()
			.then(() => {
				combined.throwIfAborted();
				return work(combined);
			})
			.then(finish, (error: unknown) => {
				if (!combined.aborted) ctx.ui.notify(`Unable to generate summary: ${String(error)}`, "error");
				finish(undefined);
			});
		return {
			render: (width) => (width > 0 ? loader.render(width).map((line) => truncateToWidth(line, width, "")) : []),
			invalidate: () => loader.invalidate(),
			handleInput: (data) => loader.handleInput(data),
			dispose() {
				finished = true;
				combined.removeEventListener("abort", abort);
				disposed.abort();
				loader.dispose();
			},
		};
	});
}

/** Width-safe inline transcript rendering; never pretends the viewport is wider. */
export function createPlanMessageComponent(
	plan: string,
	title: string | null,
	iteration: number,
	path: string | null,
	theme: Theme,
): Component {
	const markdown = new Markdown(plan, 0, 0, getMarkdownTheme());
	return {
		render(width) {
			if (width <= 0) return [];
			const heading =
				theme.fg("accent", theme.bold("Plan")) + (title ? `  ${theme.bold(singleLine(title))}` : "");
			return [
				spread(heading, theme.fg("dim", `iteration ${iteration}`), width),
				...(path ? [theme.fg("dim", tildePath(singleLine(path)))] : []),
				theme.fg("borderMuted", "─".repeat(width)),
				"",
				...markdown.render(width),
			].map((line) => truncateToWidth(line, width, ""));
		},
		invalidate: () => markdown.invalidate(),
	};
}
