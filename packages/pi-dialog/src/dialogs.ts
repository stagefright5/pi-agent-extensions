/**
 * Ready-made dialogs on top of `openPopup`. Each one accepts `signal` and `timeout` like Pi's
 * built-in dialogs and falls back to `ctx.ui.confirm/select/input/editor` outside TUI mode.
 */
import { ExtensionEditorComponent, type ExtensionUIContext, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	Key,
	Loader,
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { paintRow, paletteFromTheme } from "@stagefright5/pi-picker";
import { openPopup, type PopupContext } from "./open.ts";
import type { PopupAction, PopupBody, PopupKeys, PopupTone } from "./popup.ts";
import { singleLine } from "./text.ts";

/** The part of an extension context the dialogs use. */
export interface DialogContext {
	mode?: string;
	ui: Pick<ExtensionUIContext, "custom" | "theme" | "confirm" | "select" | "input" | "editor" | "notify">;
}

export interface DialogBaseOptions {
	title: string;
	tone?: PopupTone;
	icon?: string;
	/** Closes the dialog as cancelled. */
	signal?: AbortSignal;
	/** Milliseconds until the dialog closes as cancelled; a countdown is shown in the border. */
	timeout?: number;
	/** Overlay width in columns or a percentage. */
	width?: number | `${number}%`;
}

const tui = (ctx: DialogContext) => ctx.mode === undefined || ctx.mode === "tui";
const TONE_ICON: Record<PopupTone, string> = { accent: "●", info: "ℹ", success: "✓", warning: "!", danger: "✗" };
const overlay = (options: DialogBaseOptions, width: number | `${number}%` = 64) => ({
	width: options.width ?? width,
	minWidth: 24,
});

/** Wrapped text with a blank line above and below. */
export class MessageBody implements PopupBody {
	private readonly text: string;
	private readonly theme: () => Theme;
	private cache?: { width: number; lines: string[] };

	constructor(text: string, theme: () => Theme) {
		this.text = text;
		this.theme = theme;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (this.cache?.width === width) return this.cache.lines;
		const theme = this.theme();
		const wrapped = this.text
			.split("\n")
			.flatMap((line) => (line ? wrapTextWithAnsi(theme.fg("text", line), width) : [""]));
		this.cache = { width, lines: ["", ...wrapped.map((line) => truncateToWidth(line, width, "")), ""] };
		return this.cache.lines;
	}
}

export interface ConfirmOptions extends DialogBaseOptions {
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
}

/** Yes/no question. Danger tone focuses the safe button first. Resolves false on cancel. */
export async function confirm(ctx: DialogContext, options: ConfirmOptions): Promise<boolean> {
	if (!tui(ctx)) return ctx.ui.confirm(options.title, options.message, options);
	const tone = options.tone ?? "accent";
	const result = await openPopup<boolean>(
		ctx,
		(api) => ({
			body: new MessageBody(options.message, api.theme),
			options: {
				onAction: (value: string) => api.close(value === "yes"),
			},
		}),
		{
			title: options.title,
			icon: options.icon ?? TONE_ICON[tone],
			tone,
			focusActions: true,
			initialFocus: tone === "danger" ? "no" : "yes",
			actions: [
				{ value: "yes", key: "y", label: options.confirmLabel ?? "Yes", primary: tone !== "danger" },
				{ value: "no", key: "n", label: options.cancelLabel ?? "No", primary: tone === "danger" },
				{ value: "no", key: "tui.select.cancel", label: "cancel", hidden: true },
				{ value: "no", key: "ctrl+c", label: "cancel", hidden: true },
			],
			height: { fit: true },
			signal: options.signal,
			timeout: options.timeout,
			overlay: overlay(options),
		},
	);
	return result === true;
}

export interface AlertOptions extends DialogBaseOptions {
	message: string;
	buttonLabel?: string;
}

/** A message with one button; Enter or Esc closes it. */
export async function alert(ctx: DialogContext, options: AlertOptions): Promise<void> {
	if (!tui(ctx)) {
		ctx.ui.notify(
			`${options.title}: ${options.message}`,
			options.tone === "danger" ? "error" : options.tone === "warning" ? "warning" : "info",
		);
		return;
	}
	const tone = options.tone ?? "info";
	await openPopup<void>(
		ctx,
		(api) => ({ body: new MessageBody(options.message, api.theme), options: { onAction: () => api.close() } }),
		{
			title: options.title,
			icon: options.icon ?? TONE_ICON[tone],
			tone,
			focusActions: true,
			actions: [
				{ value: "ok", label: options.buttonLabel ?? "OK", keyText: "", primary: true },
				{ value: "ok", key: "tui.select.cancel", label: "close", hidden: true },
				{ value: "ok", key: "ctrl+c", label: "close", hidden: true },
			],
			height: { fit: true },
			signal: options.signal,
			timeout: options.timeout,
			overlay: overlay(options),
		},
	);
}

export interface SelectItem<T> {
	value: T;
	label: string;
	description?: string;
	disabled?: boolean;
}

export interface SelectOptions<T> extends DialogBaseOptions {
	message?: string;
	options: readonly SelectItem<T>[];
	initial?: T;
}

/** A list body: ↑/↓, j/k, PgUp/PgDn, Home/End, digits 1–9, click to choose. */
export class SelectBody<T> implements PopupBody {
	private readonly items: readonly SelectItem<T>[];
	private readonly message: MessageBody | undefined;
	private readonly theme: () => Theme;
	private readonly keys: PopupKeys;
	private readonly choose: (item: SelectItem<T>) => void;
	private readonly requestRender: () => void;
	selected = 0;
	private scroll = 0;
	private listTop = 0;
	private listRows = 1;

	constructor(
		items: readonly SelectItem<T>[],
		options: {
			message?: string;
			initial?: T;
			theme: () => Theme;
			keybindings: PopupKeys;
			choose(item: SelectItem<T>): void;
			requestRender(): void;
		},
	) {
		this.items = items;
		this.theme = options.theme;
		this.keys = options.keybindings;
		this.choose = options.choose;
		this.requestRender = options.requestRender;
		this.message = options.message ? new MessageBody(options.message, options.theme) : undefined;
		const initial = items.findIndex((item) => item.value === options.initial && !item.disabled);
		this.selected =
			initial >= 0
				? initial
				: Math.max(
						0,
						items.findIndex((item) => !item.disabled),
					);
	}

	get current(): SelectItem<T> | undefined {
		const item = this.items[this.selected];
		return item && !item.disabled ? item : undefined;
	}

	invalidate(): void {
		this.message?.invalidate();
	}

	naturalHeight(width: number): number {
		return (this.message ? this.message.render(width).length : 0) + this.items.length + 1;
	}

	render(width: number): string[] {
		return this.renderBody(width, this.naturalHeight(width));
	}

	renderBody(width: number, height: number): string[] {
		if (width <= 0 || height <= 0) return [];
		const theme = this.theme();
		const palette = paletteFromTheme(theme);
		const head = this.message ? this.message.render(width) : [];
		const top = Math.min(head.length, Math.max(0, height - 1));
		this.listTop = top;
		this.listRows = Math.max(1, height - top - 1);
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + this.listRows) this.scroll = this.selected - this.listRows + 1;
		this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.items.length - this.listRows)));
		const nameWidth = Math.min(
			Math.max(0, ...this.items.map((item) => visibleWidth(singleLine(item.label)))),
			Math.max(8, Math.floor(width * 0.45)),
		);
		const out = head.slice(0, top);
		for (let row = 0; row < this.listRows; row++) {
			const index = this.scroll + row;
			const item = this.items[index];
			if (!item) {
				out.push("");
				continue;
			}
			const selected = index === this.selected;
			const marker = selected ? theme.fg("accent", "›") : " ";
			const digit = index < 9 ? theme.fg("dim", String(index + 1)) : " ";
			const label = singleLine(item.label);
			const labelText = truncateToWidth(label, nameWidth, "…");
			const styled = item.disabled
				? theme.fg("dim", labelText)
				: selected
					? theme.fg("accent", theme.bold(labelText))
					: theme.fg("text", labelText);
			let text = ` ${marker} ${digit}  ${styled}`;
			if (item.description) {
				const room = width - visibleWidth(text) - nameWidth + visibleWidth(labelText) - 3;
				if (room > 4)
					text +=
						" ".repeat(nameWidth - visibleWidth(labelText) + 3) +
						theme.fg("dim", truncateToWidth(singleLine(item.description), room, "…"));
			}
			out.push(paintRow(truncateToWidth(text, width, ""), width, palette.text, selected ? palette.selected : ""));
		}
		const more = this.items.length > this.listRows ? `${this.selected + 1}/${this.items.length}` : "";
		out.push(more ? " ".repeat(Math.max(0, width - more.length)) + theme.fg("dim", more) : "");
		return out.slice(0, height);
	}

	private move(step: number): void {
		const count = this.items.length;
		if (!count) return;
		let index = this.selected;
		for (let tries = 0; tries < count; tries++) {
			index = Math.max(0, Math.min(count - 1, index + step));
			if (!this.items[index]?.disabled) {
				this.selected = index;
				break;
			}
			if (index === 0 || index === count - 1) break;
		}
		this.requestRender();
	}

	handleInput(data: string): void {
		if (this.keys.matches(data, "tui.select.up") || matchesKey(data, "k")) this.move(-1);
		else if (this.keys.matches(data, "tui.select.down") || matchesKey(data, "j")) this.move(1);
		else if (this.keys.matches(data, "tui.select.pageUp")) this.move(-Math.max(1, this.listRows - 1));
		else if (this.keys.matches(data, "tui.select.pageDown")) this.move(Math.max(1, this.listRows - 1));
		else if (matchesKey(data, Key.home)) this.move(-this.items.length);
		else if (matchesKey(data, Key.end)) this.move(this.items.length);
		else if (/^[1-9]$/.test(data)) {
			const item = this.items[Number(data) - 1];
			if (item && !item.disabled) {
				this.selected = Number(data) - 1;
				this.choose(item);
			}
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			this.move(Math.sign(event.wheelDelta ?? 0));
			return { handled: true, render: true };
		}
		const row = event.y - this.listTop;
		if (row < 0 || row >= this.listRows) return undefined;
		const index = this.scroll + row;
		const item = this.items[index];
		if (!item || item.disabled) return undefined;
		if (event.type === "press" && event.button === "left") return { handled: true };
		if (event.type === "click" && event.button === "left") {
			this.selected = index;
			this.choose(item);
			return { handled: true };
		}
		return undefined;
	}
}

/** Choose one option. Resolves with its value, or undefined when cancelled. */
export async function select<T>(ctx: DialogContext, options: SelectOptions<T>): Promise<T | undefined> {
	if (!tui(ctx)) {
		const labels = options.options.filter((item) => !item.disabled).map((item) => item.label);
		const label = await ctx.ui.select(options.title, labels, options);
		return options.options.find((item) => !item.disabled && item.label === label)?.value;
	}
	const CHOOSE = "\u0000choose";
	const CANCEL = "\u0000cancel";
	return openPopup<T>(
		ctx,
		(api) => {
			const body = new SelectBody(options.options, {
				message: options.message,
				initial: options.initial,
				theme: api.theme,
				keybindings: api.keybindings,
				choose: (item) => api.close(item.value),
				requestRender: () => api.tui.requestRender(),
			});
			return {
				body,
				options: {
					onAction: (value: string) => {
						if (value === CANCEL) return api.close();
						const item = body.current;
						if (item) api.close(item.value);
					},
				},
			};
		},
		{
			title: options.title,
			icon: options.icon,
			tone: options.tone,
			actions: [
				{ value: CHOOSE, key: "tui.select.confirm", keyText: "↵", label: "select", primary: true },
				{ value: CANCEL, key: "tui.select.cancel", keyText: "esc", label: "cancel", align: "right" },
				{ value: CANCEL, key: "ctrl+c", label: "cancel", hidden: true },
			],
			height: { fit: true, max: 0.7 },
			signal: options.signal,
			timeout: options.timeout,
			overlay: overlay(options),
		},
	);
}

export interface InputOptions extends DialogBaseOptions {
	message?: string;
	placeholder?: string;
	initial?: string;
	/** Return an error message to keep the dialog open. */
	validate?(value: string): string | undefined;
}

/** A message, a single-line input, and an inline validation error. */
export class InputBody implements PopupBody {
	readonly input: Input;
	private readonly message: MessageBody | undefined;
	private readonly theme: () => Theme;
	error: string | undefined;
	private _focused = false;

	constructor(options: { message?: string; placeholder?: string; initial?: string; theme: () => Theme }) {
		this.theme = options.theme;
		this.message = options.message ? new MessageBody(options.message, options.theme) : undefined;
		this.input = new Input({
			placeholder: options.placeholder,
			placeholderStyle: (text) => options.theme().fg("dim", text),
		});
		if (options.initial) this.input.setValue(options.initial);
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	invalidate(): void {
		this.message?.invalidate();
		this.input.invalidate();
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.theme();
		const head = this.message ? this.message.render(width) : [""];
		return [
			...head,
			...this.input.render(width),
			this.error ? theme.fg("error", truncateToWidth(singleLine(this.error), width, "…")) : "",
		];
	}

	handleInput(data: string): void {
		if (this.error) this.error = undefined;
		this.input.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		// The input sits below the message (or one blank row).
		const row = this.message ? this.message.render(event.width).length : 1;
		return event.y === row ? this.input.handleMouse({ ...event, y: 0 }) : undefined;
	}
}

/** One line of text. Resolves with the value, or undefined when cancelled. */
export async function input(ctx: DialogContext, options: InputOptions): Promise<string | undefined> {
	if (!tui(ctx)) {
		for (;;) {
			const value = await ctx.ui.input(options.title, options.placeholder, options);
			if (value === undefined) return undefined;
			const error = options.validate?.(value);
			if (!error) return value;
			ctx.ui.notify(error, "warning");
		}
	}
	const SUBMIT = "\u0000submit";
	const CANCEL = "\u0000cancel";
	return openPopup<string>(
		ctx,
		(api) => {
			const body = new InputBody({ ...options, theme: api.theme });
			return {
				body,
				options: {
					onAction: (value: string) => {
						if (value === CANCEL) return api.close();
						const text = body.input.getValue();
						const error = options.validate?.(text);
						if (error) body.error = error;
						else api.close(text);
					},
				},
			};
		},
		{
			title: options.title,
			icon: options.icon,
			tone: options.tone,
			actions: [
				{ value: SUBMIT, key: "tui.select.confirm", keyText: "↵", label: "submit", primary: true },
				{ value: CANCEL, key: "tui.select.cancel", keyText: "esc", label: "cancel", align: "right" },
				{ value: CANCEL, key: "ctrl+c", label: "cancel", hidden: true },
			],
			height: { fit: true },
			signal: options.signal,
			timeout: options.timeout,
			overlay: overlay(options),
		},
	);
}

export interface EditorOptions extends DialogBaseOptions {
	/** The prompt above the text area. */
	message?: string;
	prefill?: string;
}

/**
 * Pi's native multi-line extension editor (Enter submits, Shift+Enter adds a line, the external
 * editor key opens $EDITOR) inside a popup frame. Its own top and bottom rules are dropped.
 */
export async function editor(ctx: DialogContext, options: EditorOptions): Promise<string | undefined> {
	if (!tui(ctx)) return options.signal?.aborted ? undefined : ctx.ui.editor(options.title, options.prefill);
	return openPopup<string>(
		ctx,
		(api) => {
			const component = new ExtensionEditorComponent(
				api.tui,
				api.keybindings,
				options.message ?? "",
				options.prefill,
				(value) => api.close(value),
				() => api.close(),
			);
			const rule = (line: string | undefined) => line !== undefined && /^─+$/u.test(stripTerminalSequences(line));
			const body: PopupBody = {
				get focused() {
					return component.focused;
				},
				set focused(value: boolean) {
					component.focused = value;
				},
				render(width) {
					if (width <= 0) return [];
					const lines = component.render(width);
					const start = rule(lines[0]) ? 1 : 0;
					const end = rule(lines.at(-1)) ? lines.length - 1 : lines.length;
					return lines.slice(start, end).map((line) => truncateToWidth(line, width, ""));
				},
				invalidate: () => component.invalidate(),
				handleInput: (data) => {
					if (matchesKey(data, Key.ctrl("c"))) return api.close();
					component.handleInput(data);
				},
				handleMouse: (event) => component.handleMouse(event),
			};
			return body;
		},
		{
			title: options.title,
			icon: options.icon ?? "✎",
			tone: options.tone,
			height: { fit: true, max: 0.8 },
			padding: 1,
			signal: options.signal,
			timeout: options.timeout,
			overlay: overlay(options, "80%"),
		},
	);
}

export interface LoaderOptions {
	/** Border title; defaults to "Working". */
	title?: string;
	tone?: PopupTone;
	/** Called when `work` rejects (not when cancelled). Defaults to an error notification. */
	onError?(error: unknown): void;
}

/**
 * Run `work` behind a spinner popup. Esc, Ctrl+C or `signal` cancel it: `work`'s signal is aborted
 * and the result is undefined. Rejections are reported through `onError` and also yield undefined.
 */
export async function withLoader<T>(
	ctx: DialogContext,
	label: string,
	signal: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
	options: LoaderOptions = {},
): Promise<T | undefined> {
	if (signal.aborted) return undefined;
	const onError =
		options.onError ?? ((error: unknown) => ctx.ui.notify(`${label} failed: ${String(error)}`, "error"));
	if (!tui(ctx)) {
		try {
			return await work(signal);
		} catch (error) {
			if (!signal.aborted) onError(error);
			return undefined;
		}
	}
	const CANCEL = "\u0000cancel";
	return openPopup<T>(
		ctx,
		(api: PopupContext<T>) => {
			const combined = AbortSignal.any([signal, api.signal]);
			const loader = new Loader(
				api.tui,
				(text) => api.theme().fg("accent", text),
				(text) => api.theme().fg("text", text),
				label,
			);
			void Promise.resolve()
				.then(() => {
					combined.throwIfAborted();
					return work(combined);
				})
				.then(
					(value) => api.close(value),
					(error: unknown) => {
						if (!combined.aborted) onError(error);
						api.close();
					},
				);
			const body: PopupBody = {
				render: (width) => (width > 0 ? ["", ...loader.render(width).filter((line) => line.trim()), ""] : []),
				invalidate: () => loader.invalidate(),
				dispose: () => loader.stop(),
			};
			return {
				body,
				options: { onAction: () => api.close() },
			};
		},
		{
			title: options.title ?? "Working",
			tone: options.tone,
			actions: [
				{ value: CANCEL, key: "tui.select.cancel", keyText: "esc", label: "cancel", align: "right" },
				{ value: CANCEL, key: "ctrl+c", label: "cancel", hidden: true },
			] satisfies PopupAction[],
			height: { fit: true },
			signal,
			overlay: { width: 56, minWidth: 24 },
		},
	);
}
