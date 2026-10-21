/**
 * A scrollable markdown or diff document for a popup body: bounded native scroll state, a scroll
 * thumb, keyboard and wheel scrolling, and mouse drag selection that copies plain text.
 * Mouse coordinates arrive body-local from the popup: never parse SGR or change terminal modes.
 */
import { copyToClipboard, getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
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
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openPopup, type PopupUI } from "./open.ts";
import type { PopupAction, PopupBody, PopupHeight, PopupKeys, PopupOptions, PopupTone } from "./popup.ts";

export interface DocumentViewHost {
	theme(): Theme;
	requestRender(): void;
	keybindings: PopupKeys;
	copy(text: string): Promise<void>;
	/** Report copy results, for example in the popup footer. */
	status?(text: string, tone: "success" | "error"): void;
}

type Point = { line: number; col: number };

/** Markdown owns parsing and highlighting; cached ANSI is discarded on theme invalidation. */
class DocumentContent implements Component {
	private readonly markdown: Markdown;
	private cache?: { width: number; lines: string[] };
	private readonly content: string;
	private readonly format: "markdown" | "diff";
	private readonly getTheme: () => Theme;

	constructor(content: string, format: "markdown" | "diff", getTheme: () => Theme) {
		this.content = content;
		this.format = format;
		this.getTheme = getTheme;
		this.markdown = new Markdown(content, 0, 0, getMarkdownTheme());
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
			this.format === "diff"
				? this.content.split("\n").flatMap((line) => {
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

export class DocumentView implements PopupBody {
	readonly content: string;
	private readonly inner: DocumentContent;
	private readonly scroll: ScrollView;
	private readonly host: DocumentViewHost;
	private lines: string[] = [];
	private height = 1;
	private width = 0;
	private anchor?: Point;
	private focus?: Point;
	private selecting = false;
	private disposed = false;
	private copySequence = 0;

	constructor(content: string, format: "markdown" | "diff" = "markdown", host: DocumentViewHost) {
		this.content = content;
		this.host = host;
		this.inner = new DocumentContent(content, format, () => host.theme());
		this.scroll = new ScrollView(this.inner, { overscroll: "contain", scrollbar: "hidden" });
	}

	/** Columns reserved on the right for the scroll thumb. */
	private gutter(width: number): number {
		return width >= 12 ? 2 : 0;
	}

	invalidate(): void {
		this.inner.invalidate();
		this.anchor = this.focus = undefined;
		this.selecting = false;
	}

	dispose(): void {
		this.disposed = true;
		this.copySequence++;
	}

	naturalHeight(width: number): number {
		return this.inner.render(Math.max(1, width - this.gutter(width))).length;
	}

	/** "top", "end", a percentage, or "" when everything fits. */
	position(): string {
		const total = this.lines.length;
		if (total <= this.height) return "";
		const top = this.scroll.scrollTop;
		if (top === 0) return "top";
		if (top + this.height >= total) return "end";
		return `${Math.round((top / Math.max(1, total - this.height)) * 100)}%`;
	}

	render(width: number): string[] {
		return this.renderBody(width, Math.max(1, this.height));
	}

	renderBody(width: number, height: number): string[] {
		if (width <= 0 || height <= 0) return [];
		if (this.width !== width) {
			this.anchor = this.focus = undefined;
			this.selecting = false;
		}
		this.width = width;
		this.height = height;
		const gutter = this.gutter(width);
		const textWidth = Math.max(1, width - gutter);
		this.lines = this.scroll.render(textWidth);
		this.scroll.updateLayout(this.lines.length, height, () => {
			if (!this.disposed) this.host.requestRender();
		});
		const total = this.lines.length;
		const top = this.scroll.scrollTop;
		const overflow = total > height;
		const thumbSize = overflow ? Math.max(1, Math.round((height * height) / total)) : 0;
		const thumbTop = overflow ? Math.round((top / Math.max(1, total - height)) * (height - thumbSize)) : 0;
		const theme = this.host.theme();
		const out: string[] = [];
		for (let row = 0; row < height; row++) {
			const line = this.lines[top + row];
			const text = line === undefined ? "" : this.highlight(line, top + row);
			const thumb = overflow && gutter && row >= thumbTop && row < thumbTop + thumbSize;
			out.push(
				thumb ? text + " ".repeat(Math.max(0, width - 1 - visibleWidth(text))) + theme.fg("dim", "┃") : text,
			);
		}
		return out;
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		const kb = this.host.keybindings;
		if (kb.matches(data, "tui.select.up") || matchesKey(data, "k")) this.scroll.scrollBy(-1);
		else if (kb.matches(data, "tui.select.down") || matchesKey(data, "j")) this.scroll.scrollBy(1);
		else if (kb.matches(data, "tui.select.pageUp")) this.scroll.scrollBy(-this.height);
		else if (kb.matches(data, "tui.select.pageDown") || matchesKey(data, Key.space))
			this.scroll.scrollBy(this.height);
		else if (matchesKey(data, Key.home) || matchesKey(data, "g")) this.scroll.scrollToStart();
		else if (matchesKey(data, Key.end) || matchesKey(data, "shift+g")) this.scroll.scrollToEnd();
		else return;
		this.host.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.disposed) return undefined;
		if (event.type === "wheel") {
			this.scroll.scrollBy(event.wheelDelta ?? 0);
			return { handled: true, render: true };
		}
		const inside = event.y >= 0 && event.y < this.height;
		if (event.type === "press" && event.button === "left" && inside && this.lines.length) {
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

	/** Copy text and report the result through the host. Results after disposal are dropped. */
	copy(text: string = this.content, success = "Copied full document"): void {
		const sequence = ++this.copySequence;
		void this.host
			.copy(text)
			.then(
				() => ({ text: success, tone: "success" as const }),
				(error: unknown) => ({ text: `Copy failed: ${String(error)}`, tone: "error" as const }),
			)
			.then((result) => {
				if (this.disposed || sequence !== this.copySequence) return;
				this.host.status?.(result.text, result.tone);
			});
	}

	private point(event: TuiMouseEvent): Point {
		const line = Math.min(
			this.lines.length - 1,
			this.scroll.scrollTop + Math.max(0, Math.min(this.height - 1, event.y)),
		);
		return {
			line,
			col: Math.max(0, Math.min(this.width, visibleWidth(this.lines[line] ?? ""), event.x)),
		};
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
			const line = this.lines[i] ?? "";
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
}

export interface DocumentAction<A extends string = string> {
	/** A key id (`a`, `shift+s`) or a Pi keybinding id. */
	key: string;
	label: string;
	value: A;
	/** Drawn as the one emphasised chip. */
	primary?: boolean;
}

export interface DocumentOptions<A extends string = string> {
	/** What the document is, for example "Plan review"; drawn in the accent colour. */
	kind?: string;
	title: string;
	/** Right side of the border, for example "iteration 2"; the scroll position follows it. */
	meta?: string;
	subtitle?: string;
	content: string;
	format?: "markdown" | "diff";
	actions?: readonly DocumentAction<A>[];
	tone?: PopupTone;
	icon?: string;
	height?: PopupHeight;
}

const COPY = "\u0000copy" as const;
const CANCEL = "cancel" as const;

/** Popup actions for a document: workflow actions left; copy and close right; Ctrl+C and Enter as keys. */
export function documentActions<A extends string>(
	actions: readonly DocumentAction<A>[] = [],
): PopupAction<A | typeof CANCEL | typeof COPY>[] {
	const cancel: typeof CANCEL = CANCEL;
	return [
		...actions.map((action) => ({ ...action })),
		{ value: COPY, key: "c", label: "copy", align: "right" },
		{ value: CANCEL, key: "tui.select.cancel", keyText: "esc", label: "close", align: "right" },
		{ value: CANCEL, key: "ctrl+c", label: "close", hidden: true },
		...(actions.length ? [] : [{ value: cancel, key: "tui.select.confirm", label: "close", hidden: true }]),
	];
}

export interface DocumentPopupHost {
	theme(): Theme;
	requestRender(): void;
	keybindings: PopupKeys;
	copy(text: string): Promise<void>;
	setStatus(text: string, tone: "success" | "error"): void;
}

/**
 * The document body and its popup options. `showDocument` uses this inside `openPopup`; tests and
 * custom hosts can pass the result to `new Popup(view, options, host)`.
 */
export function documentPopup<A extends string>(
	options: DocumentOptions<A>,
	host: DocumentPopupHost,
	close: (value: A | "cancel") => void,
): { view: DocumentView; options: PopupOptions<A | typeof CANCEL | typeof COPY> } {
	const view = new DocumentView(options.content, options.format, {
		theme: host.theme,
		requestRender: host.requestRender,
		keybindings: host.keybindings,
		copy: host.copy,
		status: host.setStatus,
	});
	return {
		view,
		options: {
			kind: options.kind,
			title: options.title,
			icon: options.icon,
			subtitle: options.subtitle,
			tone: options.tone,
			meta: () => [options.meta ?? "", view.position()].filter(Boolean).join(" · "),
			height: options.height ?? { max: 0.9 },
			actions: documentActions(options.actions),
			onAction(value) {
				if (value === COPY) view.copy();
				else close(value);
			},
		},
	};
}

/**
 * Show a document popup and resolve with the chosen action's value, or "cancel" (Esc, Ctrl+C,
 * abort, or outside TUI mode).
 */
export async function showDocument<A extends string>(
	ctx: PopupUI & { mode?: string },
	options: DocumentOptions<A>,
	signal?: AbortSignal,
): Promise<A | "cancel"> {
	if (signal?.aborted || (ctx.mode !== undefined && ctx.mode !== "tui")) return "cancel";
	const result = await openPopup<A | "cancel", A | typeof CANCEL | typeof COPY>(
		ctx,
		(api) => {
			const built = documentPopup(
				options,
				{
					theme: api.theme,
					requestRender: () => api.tui.requestRender(),
					keybindings: api.keybindings,
					copy: async (text) => {
						await copyToClipboard(text);
					},
					setStatus: (text, tone) => api.popup.setStatus(text, tone),
				},
				api.close,
			);
			return { body: built.view, options: built.options };
		},
		{ signal, overlay: { width: "90%" } },
	);
	return result ?? "cancel";
}
