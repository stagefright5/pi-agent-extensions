/**
 * A tiny cross-extension contract, owned by neither package (Compact Status Bar keeps an identical copy): the status bar lends its line to an
 * editor that can draw it (Prompt Truly Mine's composer footer), and the footer steps aside while
 * that editor hosts it. Neither package imports the other; both only agree on this global key.
 */
export const STATUS_LINE_CHANNEL = Symbol.for("@stagefright5/pi-status-line/v1");

export type StatusLineHost = {
	/** True only while the host is focused and drew the line in its latest render. */
	hostsStatusLine(): boolean;
};

export type StatusLineChannel = {
	/**
	 * One status line exactly `width` cells wide. `extras` (already styled, most important first,
	 * e.g. a mode label then hints) follow the directory; the last is dropped first when narrow.
	 */
	render?: (width: number, extras?: readonly string[]) => string;
	host?: StatusLineHost;
};

export function statusLineChannel(): StatusLineChannel {
	const store = globalThis as typeof globalThis & { [STATUS_LINE_CHANNEL]?: StatusLineChannel };
	return (store[STATUS_LINE_CHANNEL] ??= {});
}
