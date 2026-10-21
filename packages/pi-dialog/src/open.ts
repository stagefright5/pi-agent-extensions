import type { ExtensionUIContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { Popup, type PopupBody, type PopupOptions } from "./popup.ts";

/** The part of an extension context a popup needs. */
export interface PopupUI {
	ui: Pick<ExtensionUIContext, "custom" | "theme">;
}

export interface PopupContext<T, V = string> {
	tui: TUI;
	theme(): Theme;
	keybindings: KeybindingsManager;
	/** Close with a result; later calls are ignored. */
	close(value?: T): void;
	/** The popup frame (available once `build` returns). */
	readonly popup: Popup<V>;
	/** Aborted when the popup closes for any reason. */
	signal: AbortSignal;
}

/** A body plus popup options that depend on it (merged over the options passed to `openPopup`). */
export interface BuiltPopup<V = string> {
	body: PopupBody;
	options: PopupOptions<V>;
}

const isBuilt = <V>(value: PopupBody | BuiltPopup<V>): value is BuiltPopup<V> =>
	typeof (value as PopupBody).render !== "function" && "body" in value;

export interface OpenPopupOptions<V = string> extends PopupOptions<V> {
	/** Closes the popup with `undefined`. */
	signal?: AbortSignal;
	/** Milliseconds until the popup closes with `undefined`; a countdown is shown after the meta. */
	timeout?: number;
	/** Overlay placement; defaults to centred, 80% wide. Height is controlled by `height`. */
	overlay?: OverlayOptions;
}

/**
 * Show `build`'s component in a framed overlay and resolve with the value passed to `close`, or
 * `undefined` when cancelled, aborted, or timed out. Closing is idempotent, and abort/timer
 * listeners are removed exactly once, also when the host disposes the popup.
 */
export async function openPopup<T, V = string>(
	ctx: PopupUI,
	build: (api: PopupContext<T, V>) => PopupBody | BuiltPopup<V>,
	options: OpenPopupOptions<V> = {},
): Promise<T | undefined> {
	const { signal, timeout, overlay, ...popupOptions } = options;
	if (signal?.aborted) return undefined;
	return ctx.ui.custom<T | undefined>(
		(tui, _theme, keybindings, done) => {
			const lifetime = new AbortController();
			let closed = false;
			let timer: ReturnType<typeof setInterval> | undefined;
			const cleanup = () => {
				signal?.removeEventListener("abort", abort);
				clearInterval(timer);
				timer = undefined;
				lifetime.abort();
			};
			const close = (value?: T) => {
				if (closed) return;
				closed = true;
				cleanup();
				done(value);
			};
			const abort = () => close(undefined);
			let popup: Popup<V> | undefined;
			const api: PopupContext<T, V> = {
				tui,
				theme: () => ctx.ui.theme,
				keybindings,
				close,
				get popup() {
					if (!popup) throw new Error("The popup is not available until build() returns");
					return popup;
				},
				signal: lifetime.signal,
			};
			const built = build(api);
			popup = new Popup<V>(
				isBuilt(built) ? built.body : built,
				isBuilt(built) ? { ...popupOptions, ...built.options } : popupOptions,
				{
					rows: () => tui.terminal.rows,
					theme: () => ctx.ui.theme,
					requestRender: () => {
						if (!closed) tui.requestRender();
					},
					keybindings,
				},
				() => {
					closed = true;
					cleanup();
				},
			);
			signal?.addEventListener("abort", abort, { once: true });
			if (timeout !== undefined && timeout > 0) {
				const deadline = Date.now() + timeout;
				const update = () => {
					const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
					if (left <= 0) return close(undefined);
					popup?.setTimer(`${left}s`);
				};
				update();
				timer = setInterval(update, 250);
			}
			if (signal?.aborted) abort();
			return popup;
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "80%", minWidth: 30, ...overlay },
		},
	);
}
