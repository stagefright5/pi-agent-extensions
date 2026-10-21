/**
 * A framed overlay shell for any component: rounded border in the tone colour with the title and
 * meta set into it, a tinted panel, an optional footer of action chips, and a one-cell drop shadow.
 *
 * The body gets an exact rectangle. Height-aware bodies implement `renderBody(width, height)`; any
 * other component is rendered at the body width and sliced or padded to the body height. Keys go to
 * the body unless they match a declared action; mouse events are translated to body-local
 * coordinates. The shell degrades on small terminals: no shadow, then no border, then no footer.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type KeyId,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { keyLabel, paintRow, paletteFromTheme, type Palette } from "@stagefright5/pi-picker";
import { resolve, singleLine, spread, tildePath, type Dynamic } from "./text.ts";

export type PopupTone = "accent" | "info" | "success" | "warning" | "danger";

/** The subset of Pi's keybindings manager the popup needs. */
export interface PopupKeys {
	matches(data: string, id: string): boolean;
	getKeys?(id: string): string[];
}

export interface PopupAction<V = string> {
	value: V;
	label: string;
	/**
	 * A key id understood by `matchesKey` (`a`, `shift+s`, `ctrl+y`) or a Pi keybinding id (contains
	 * a dot, for example `tui.select.cancel`). Omit for click- or focus-only buttons.
	 */
	key?: string;
	/** Key text drawn in the chip; defaults to a short label for `key`. Use "" to draw the label only. */
	keyText?: string;
	/** The one emphasised chip. */
	primary?: boolean;
	/** `right` for trailing utilities such as copy and close. */
	align?: "left" | "right";
	/** Matches its key but is not drawn. */
	hidden?: boolean;
}

export interface PopupHeight {
	/** Largest height: a fraction of the terminal rows when ≤ 1, otherwise rows. Default 0.8. */
	max?: number;
	/** Smallest height in rows when fitting. */
	min?: number;
	/** Shrink to the body's natural height instead of always using `max`. */
	fit?: boolean;
}

export interface PopupOptions<V = string> {
	/** What the popup is, for example "Plan review"; drawn in the accent colour before the title. */
	kind?: Dynamic<string | undefined>;
	title?: Dynamic<string | undefined>;
	/** A glyph before the heading, for example "●" or "!". */
	icon?: string;
	/** Right side of the top border, for example "iteration 2 · 34%". */
	meta?: Dynamic<string | undefined>;
	/** A dim line under the border, for example a file path (the home directory becomes `~`). */
	subtitle?: Dynamic<string | undefined>;
	tone?: PopupTone;
	actions?: Dynamic<readonly PopupAction<V>[]>;
	onAction?(value: V): void;
	/** Buttons with a focus ring: Tab/←/→ move it, Enter activates the focused button. */
	focusActions?: boolean;
	initialFocus?: V;
	/** A free-form footer row instead of action chips. */
	footer?(width: number, palette: Palette): string;
	/** Default true. Dropped automatically on small terminals. */
	shadow?: boolean;
	/** Horizontal padding inside the frame. Defaults to 2 (1 on narrow popups). */
	padding?: number;
	/** Total rows including frame and shadow; or a function returning rows. Default 80% of the terminal. */
	height?: PopupHeight | (() => number);
}

export interface PopupHost {
	rows(): number;
	theme(): Theme;
	requestRender(): void;
	keybindings: PopupKeys;
}

/** A popup body. Height-aware bodies implement `renderBody`; `naturalHeight` lets them fit. */
export interface PopupBody extends Component {
	renderBody?(width: number, height: number): string[];
	naturalHeight?(width: number): number;
	focused?: boolean;
	dispose?(): void;
}

/** The resolved geometry of the last render. All positions are popup-local. */
export interface PopupLayout {
	width: number;
	height: number;
	frameWidth: number;
	border: boolean;
	shadow: boolean;
	padX: number;
	bodyLeft: number;
	bodyTop: number;
	bodyWidth: number;
	bodyHeight: number;
	/** -1 when there is no footer. */
	footerRow: number;
	/** A heading row inside the panel (only when there is no border to carry it). */
	titleRow: boolean;
	/** Subtitle line plus an optional spacer. */
	subtitleRows: number;
}

const TONE: Record<PopupTone, ThemeColor> = {
	accent: "borderAccent",
	info: "accent",
	success: "success",
	warning: "warning",
	danger: "error",
};
const TRUECOLOR = /\[(?:38|48);2;(\d+);(\d+);(\d+)m/u;
/** Below these sizes the shadow, then the border, are dropped. */
const SHADOW_MIN_WIDTH = 24;
const SHADOW_MIN_HEIGHT = 8;
const BORDER_MIN_WIDTH = 12;
const BORDER_MIN_HEIGHT = 5;
const FOOTER_MIN_HEIGHT = 4;

/** Shadow glyph colour: the panel pushed toward black, or the theme's dim colour without truecolor. */
function shadowAnsi(palette: Palette, theme: Theme): string {
	const match = TRUECOLOR.exec(palette.panel);
	if (!match) return theme.getFgAnsi("dim");
	const [r, g, b] = [match[1], match[2], match[3]].map((value) => Math.round(Number(value) * 0.45));
	return `\x1b[38;2;${r};${g};${b}m`;
}

function fit(line: string, width: number): string {
	const cut = visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
}

export class Popup<V = string> implements Component, Focusable {
	readonly body: PopupBody;
	private readonly options: PopupOptions<V>;
	private readonly host: PopupHost;
	private readonly onDispose: () => void;
	private _focused = false;
	private focusIndex = 0;
	private status: { text: string; tone: "info" | "success" | "warning" | "error" } | undefined;
	private timer: string | undefined;
	private targets: Array<{ from: number; to: number; action: PopupAction<V> }> = [];
	private capturing = false;
	private disposed = false;
	private cache = new Map<string, string>();
	private cacheTheme: Theme | undefined;
	layout: PopupLayout | undefined;

	constructor(body: PopupBody, options: PopupOptions<V>, host: PopupHost, onDispose: () => void = () => {}) {
		this.body = body;
		this.options = options;
		this.host = host;
		this.onDispose = onDispose;
		const initial = this.leftActions().findIndex((action) => action.value === options.initialFocus);
		this.focusIndex = Math.max(
			0,
			initial >= 0 ? initial : this.leftActions().findIndex((action) => action.primary),
		);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		if ("focused" in this.body) this.body.focused = value;
	}

	/** Change a popup option after construction (for example the title when the body switches views). */
	set<K extends keyof PopupOptions<V>>(key: K, value: PopupOptions<V>[K]): void {
		this.options[key] = value;
		this.cache.clear();
		this.host.requestRender();
	}

	/** A message on the right of the footer (replaces right-aligned actions); undefined clears it. */
	setStatus(text: string | undefined, tone: "info" | "success" | "warning" | "error" = "success"): void {
		this.status = text ? { text: singleLine(text), tone } : undefined;
		this.host.requestRender();
	}

	/** A countdown shown after the meta, for example "5s". */
	setTimer(text: string | undefined): void {
		if (text === this.timer) return;
		this.timer = text;
		this.host.requestRender();
	}

	/** The body rectangle of the last render, or an estimate before the first one. */
	bodySize(): { width: number; height: number } {
		if (this.layout) return { width: this.layout.bodyWidth, height: this.layout.bodyHeight };
		return { width: 80, height: Math.max(1, this.maxHeight() - 4) };
	}

	invalidate(): void {
		this.cache.clear();
		this.body.invalidate();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.body.dispose?.();
		this.onDispose();
	}

	private actions(): readonly PopupAction<V>[] {
		return this.options.actions ? resolve(this.options.actions) : [];
	}

	private leftActions(): PopupAction<V>[] {
		return this.actions().filter((action) => !action.hidden && action.align !== "right");
	}

	private maxHeight(): number {
		const rows = Math.max(1, this.host.rows());
		const option = this.options.height;
		if (typeof option === "function") return Math.max(1, Math.min(rows, Math.floor(option())));
		const ratio = option?.max ?? 0.8;
		return Math.max(1, Math.min(rows, ratio <= 1 ? Math.floor(rows * ratio) : Math.floor(ratio)));
	}

	private computeLayout(width: number): { layout: PopupLayout; lines: string[] | undefined } {
		const max = this.maxHeight();
		const shadow = this.options.shadow !== false && width >= SHADOW_MIN_WIDTH && max >= SHADOW_MIN_HEIGHT;
		const frameWidth = width - (shadow ? 1 : 0);
		const available = max - (shadow ? 1 : 0);
		const border = frameWidth >= BORDER_MIN_WIDTH && available >= BORDER_MIN_HEIGHT;
		const heading = this.heading(false);
		const titleRow = !border && heading !== "" && available >= 3;
		const hasFooter =
			this.options.footer !== undefined ||
			this.status !== undefined ||
			this.actions().some((action) => !action.hidden);
		const footer = hasFooter && available >= FOOTER_MIN_HEIGHT;
		const footerRows = footer ? (border ? 2 : 1) : 0;
		const inner = Math.max(0, frameWidth - (border ? 2 : 0));
		const wanted = this.options.padding ?? (inner >= 40 ? 2 : inner >= 16 ? 1 : 0);
		const padX = Math.max(0, Math.min(wanted, Math.floor((inner - 1) / 2)));
		const bodyWidth = Math.max(1, inner - 2 * padX);
		const fixed = (border ? 2 : 0) + (titleRow ? 1 : 0) + footerRows;
		const subtitleText = this.options.subtitle ? resolve(this.options.subtitle) : undefined;
		const subtitleRows = subtitleText ? (available - fixed >= 10 ? 2 : available - fixed >= 6 ? 1 : 0) : 0;
		let bodyHeight = Math.max(1, available - fixed - subtitleRows);
		let lines: string[] | undefined;
		const option = this.options.height;
		if (option && typeof option !== "function" && option.fit) {
			let natural: number;
			if (this.body.renderBody) natural = this.body.naturalHeight?.(bodyWidth) ?? bodyHeight;
			else {
				lines = this.body.render(bodyWidth);
				natural = lines.length;
			}
			const min = Math.max(1, (option.min ?? 0) - fixed - subtitleRows - (shadow ? 1 : 0));
			bodyHeight = Math.max(1, Math.min(bodyHeight, Math.max(min, natural)));
		}
		const height = fixed + subtitleRows + bodyHeight + (shadow ? 1 : 0);
		const bodyTop = (border || titleRow ? 1 : 0) + subtitleRows;
		return {
			layout: {
				width,
				height,
				frameWidth,
				border,
				shadow,
				padX,
				bodyLeft: (border ? 1 : 0) + padX,
				bodyTop,
				bodyWidth,
				bodyHeight,
				footerRow: footer ? bodyTop + bodyHeight + (border ? 1 : 0) : -1,
				titleRow,
				subtitleRows,
			},
			lines,
		};
	}

	/** Icon, kind and title on one line; plain text when `styled` is false (for measuring). */
	private heading(styled: boolean, palette?: Palette): string {
		const kind = this.options.kind ? singleLine(resolve(this.options.kind) ?? "") : "";
		const title = this.options.title ? singleLine(resolve(this.options.title) ?? "") : "";
		const icon = this.options.icon ? singleLine(this.options.icon) : "";
		if (!styled || !palette) return [icon, kind, title].filter(Boolean).join(" ");
		const tone = this.toneColor();
		const parts = [
			icon ? this.host.theme().fg(tone, icon) : "",
			kind ? palette.fg("accent", palette.bold(kind)) : "",
			title ? palette.bold(title) : "",
		].filter(Boolean);
		return parts.length === 3 ? `${parts[0]} ${parts[1]}  ${parts[2]}` : parts.join(kind && title ? "  " : " ");
	}

	private toneColor(): ThemeColor {
		return TONE[this.options.tone ?? "accent"];
	}

	private metaText(): string {
		const meta = this.options.meta ? singleLine(resolve(this.options.meta) ?? "") : "";
		return [meta, this.timer ?? ""].filter(Boolean).join(" · ");
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.host.theme();
		if (theme !== this.cacheTheme) {
			this.cache.clear();
			this.cacheTheme = theme;
		}
		const palette = paletteFromTheme(theme);
		const { layout, lines: fitted } = this.computeLayout(width);
		this.layout = layout;
		const { frameWidth, border, padX, bodyWidth, bodyHeight } = layout;
		const inner = Math.max(0, frameWidth - (border ? 2 : 0));
		const tone = this.toneColor();
		const line = (glyphs: string, color: ThemeColor = tone) => theme.fg(color, glyphs);
		const row = (content: string) =>
			paintRow(
				(border ? line("│") : "") +
					" ".repeat(padX) +
					fit(content, bodyWidth) +
					" ".repeat(Math.max(0, inner - padX - bodyWidth)) +
					(border ? line("│") : ""),
				frameWidth,
				palette.text,
				palette.panel,
			);

		// The body renders first so chrome that reflects its state (for example a scroll position) is current.
		const body =
			fitted ??
			(this.body.renderBody ? this.body.renderBody(bodyWidth, bodyHeight) : this.body.render(bodyWidth));
		const out: string[] = [];
		const meta = this.metaText();
		if (border) out.push(this.topBorder(frameWidth, palette, meta));
		else if (layout.titleRow)
			out.push(row(spread(this.heading(true, palette), palette.fg("dim", meta), bodyWidth)));
		if (layout.subtitleRows > 0) {
			const subtitle = this.options.subtitle ? (resolve(this.options.subtitle) ?? "") : "";
			out.push(row(palette.fg("dim", tildePath(singleLine(subtitle)))));
			if (layout.subtitleRows > 1) out.push(row(""));
		}

		for (let index = 0; index < bodyHeight; index++) out.push(row(body[index] ?? ""));

		this.targets = [];
		if (layout.footerRow >= 0) {
			if (border) {
				const key = `sep\u0000${frameWidth}\u0000${tone}`;
				let separator = this.cache.get(key);
				if (!separator) {
					separator = paintRow(
						line("├") + line("─".repeat(inner), "borderMuted") + line("┤"),
						frameWidth,
						palette.text,
						palette.panel,
					);
					this.cache.set(key, separator);
				}
				out.push(separator);
			}
			out.push(row(this.footer(bodyWidth, palette, layout.bodyLeft)));
		}
		if (border) {
			const key = `bottom\u0000${frameWidth}\u0000${tone}`;
			let bottom = this.cache.get(key);
			if (!bottom) {
				// Corners share the panel background so the card has no notched corners.
				bottom = paintRow(
					line("╰" + "─".repeat(frameWidth - 2) + "╯"),
					frameWidth,
					palette.text,
					palette.panel,
				);
				this.cache.set(key, bottom);
			}
			out.push(bottom);
		}

		if (layout.shadow) {
			const shade = shadowAnsi(palette, theme);
			for (let index = 0; index < out.length; index++)
				out[index] = out[index] + "\x1b[0m" + (index === 0 ? " " : `${shade}▌\x1b[39m`);
			out.push(" " + shade + "▀".repeat(Math.max(0, frameWidth - 1)) + "▘\x1b[39m");
		}
		return out.map((text) => (visibleWidth(text) > width ? truncateToWidth(text, width, "") : text));
	}

	private topBorder(frameWidth: number, palette: Palette, meta: string): string {
		const heading = this.heading(true, palette);
		const key = `top\u0000${frameWidth}\u0000${this.toneColor()}\u0000${heading}\u0000${meta}`;
		const cached = this.cache.get(key);
		if (cached) return cached;
		const theme = this.host.theme();
		const line = (glyphs: string) => theme.fg(this.toneColor(), glyphs);
		const middle = frameWidth - 2;
		// "─ heading ─…─ meta ─": the heading keeps at least a few cells; the meta goes first when tight.
		let metaPart = meta ? ` ${meta} ` : "";
		const headingWidth = visibleWidth(heading);
		if (metaPart && middle - 4 - visibleWidth(metaPart) < Math.min(headingWidth, 10)) metaPart = "";
		const room = Math.max(0, middle - 4 - visibleWidth(metaPart));
		const head = headingWidth ? truncateToWidth(heading, room, "…") : "";
		const lead = head ? line("─ ") + head + " " : line("─");
		const fill = Math.max(0, middle - visibleWidth(lead) - visibleWidth(metaPart) - 1);
		const content = lead + line("─".repeat(fill)) + (metaPart ? palette.fg("dim", metaPart) : "") + line("─");
		const top = paintRow(line("╭") + fit(content, middle) + line("╮"), frameWidth, palette.text, palette.panel);
		this.cache.set(key, top);
		return top;
	}

	private keyText(action: PopupAction<V>): string {
		if (action.keyText !== undefined) return action.keyText;
		if (!action.key) return "";
		if (action.key.includes(".")) {
			const bound = this.host.keybindings.getKeys?.(action.key)?.[0];
			return bound ? keyLabel(bound) : "";
		}
		// Plain letters stay lowercase: "A" would read as Shift+A.
		return action.key.length === 1 ? action.key : keyLabel(action.key);
	}

	private chip(action: PopupAction<V>, palette: Palette, highlighted: boolean): string {
		const key = this.keyText(action);
		if (highlighted) {
			const text = ` ${key ? key + " " : ""}${action.label} `;
			const theme = this.host.theme();
			const color: ThemeColor = this.options.tone === "danger" ? "error" : "accent";
			return paintRow(theme.fg(color, theme.bold(text)), visibleWidth(text), "", palette.selected);
		}
		if (this.options.focusActions) return palette.fg("muted", ` ${key ? key + " " : ""}${action.label} `);
		return (key ? palette.fg("muted", key) + " " : "") + palette.fg("dim", action.label);
	}

	/** Left: workflow actions (the primary or focused one as a filled chip). Right: utilities or status. */
	private footer(width: number, palette: Palette, left0: number): string {
		if (this.options.footer && !this.status) return this.options.footer(width, palette);
		const all = this.actions().filter((action) => !action.hidden);
		const left = all.filter((action) => action.align !== "right");
		const right = all.filter((action) => action.align === "right");
		const focused = this.options.focusActions ? left[Math.min(this.focusIndex, left.length - 1)] : undefined;
		const lit = (action: PopupAction<V>) => (focused ? action === focused : action.primary === true);
		const gap = this.options.focusActions ? 2 : 3;
		const join = (items: readonly PopupAction<V>[]) =>
			items.map((action) => this.chip(action, palette, lit(action))).join(" ".repeat(gap));
		const status = this.status
			? palette.fg(this.status.tone === "info" ? "accent" : this.status.tone, this.status.text)
			: undefined;
		const rightText = status ?? join(right);
		// Drop secondary actions from the end until the row fits; the highlighted one stays.
		const shown = [...left];
		while (shown.length > 1 && visibleWidth(join(shown)) + 3 + visibleWidth(rightText) > width) {
			const last = shown.findLastIndex((action) => !lit(action));
			if (last < 0) break;
			shown.splice(last, 1);
		}
		const leftText = join(shown);
		let x = left0;
		for (const action of shown) {
			const cell = visibleWidth(this.chip(action, palette, lit(action)));
			this.targets.push({ from: x, to: x + cell, action });
			x += cell + gap;
		}
		if (!status && right.length) {
			let rx = left0 + Math.max(visibleWidth(leftText) + 1, width - visibleWidth(rightText));
			for (const action of right) {
				const cell = visibleWidth(this.chip(action, palette, lit(action)));
				this.targets.push({ from: rx, to: rx + cell, action });
				rx += cell + gap;
			}
		}
		return spread(leftText, rightText, width);
	}

	private matches(data: string, key: string): boolean {
		return key.includes(".") ? this.host.keybindings.matches(data, key) : matchesKey(data, key as KeyId);
	}

	private activate(action: PopupAction<V>): void {
		if (this.disposed) return;
		this.options.onAction?.(action.value);
		this.host.requestRender();
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (this.options.focusActions) {
			const left = this.leftActions();
			if (left.length) {
				const move = (step: number) => {
					this.focusIndex = (this.focusIndex + step + left.length) % left.length;
					this.host.requestRender();
				};
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) return move(1);
				if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) return move(-1);
				if (this.host.keybindings.matches(data, "tui.select.confirm"))
					return this.activate(left[Math.min(this.focusIndex, left.length - 1)]!);
			}
		}
		const action = this.actions().find((candidate) => candidate.key && this.matches(data, candidate.key));
		if (action) return this.activate(action);
		this.body.handleInput?.(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const layout = this.layout;
		if (this.disposed || !layout) return undefined;
		const local = (): TuiMouseEvent => ({
			...event,
			x: event.x - layout.bodyLeft,
			y: event.y - layout.bodyTop,
			width: layout.bodyWidth,
			height: layout.bodyHeight,
		});
		if (this.capturing) {
			if (event.type === "release") this.capturing = false;
			return this.body.handleMouse?.(local()) ?? { handled: true };
		}
		if (event.type === "wheel") return this.body.handleMouse?.(local());
		if (event.y === layout.footerRow && event.button === "left") {
			if (event.type === "click") {
				const target = this.targets.find((item) => event.x >= item.from && event.x < item.to);
				if (target) this.activate(target.action);
			}
			return event.type === "click" || event.type === "press" ? { handled: true } : undefined;
		}
		const inBody =
			event.x >= layout.bodyLeft &&
			event.x < layout.bodyLeft + layout.bodyWidth &&
			event.y >= layout.bodyTop &&
			event.y < layout.bodyTop + layout.bodyHeight;
		if (!inBody) return undefined;
		const result = this.body.handleMouse?.(local());
		if (result?.capture) this.capturing = true;
		return result;
	}
}
