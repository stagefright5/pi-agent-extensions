/**
 * A tiny cross-extension contract, owned by neither package (Compact Status Bar keeps an identical copy): the status bar lends its line to an
 * editor that can draw it (Prompt Truly Mine's composer footer), and the footer steps aside while
 * that editor hosts it. Neither package imports the other; both only agree on this global key.
 *
 * Extensions may also make their footer status clickable: `registerStatusAction(id, …)` with the
 * same id they pass to `ctx.ui.setStatus`. Whichever component draws the line hit-tests clicks with
 * `statusAt(column)`; the status bar owns keyboard focus (`focusedStatus`). Every field is optional,
 * so older copies of this file keep working alongside newer ones.
 */
export const STATUS_LINE_CHANNEL = Symbol.for("@stagefright5/pi-status-line/v1");

export type StatusLineHost = {
	/** True only while the host is focused and drew the line in its latest render. */
	hostsStatusLine(): boolean;
};

export type StatusAction = {
	/** Short verb shown while the status has keyboard focus, for example "jobs". */
	label: string;
	activate(): void;
};

/** Columns `[start, end)` of one extension status, relative to the start of the rendered line. */
export type StatusRegion = { id: string; start: number; end: number };

export type StatusLineChannel = {
	/**
	 * One status line exactly `width` cells wide. `extras` (already styled, most important first,
	 * e.g. a mode label then hints) follow the directory; the last is dropped first when narrow.
	 */
	render?: (width: number, extras?: readonly string[]) => string;
	host?: StatusLineHost;
	/** Clickable statuses, keyed by their `ctx.ui.setStatus` id. */
	statusActions?: Map<string, StatusAction>;
	/** Status positions in the latest rendered line; replaced on every layout. */
	regions?: readonly StatusRegion[];
	/** The status with keyboard focus, drawn highlighted. */
	focusedStatus?: string;
	/** Bumped whenever actions or focus change, so renderers can key caches on it. */
	version?: number;
};

export function statusLineChannel(): StatusLineChannel {
	const store = globalThis as typeof globalThis & { [STATUS_LINE_CHANNEL]?: StatusLineChannel };
	return (store[STATUS_LINE_CHANNEL] ??= {});
}

/** Make the status with this id clickable; returns a function that removes exactly this action. */
export function registerStatusAction(id: string, action: StatusAction): () => void {
	const channel = statusLineChannel();
	(channel.statusActions ??= new Map()).set(id, action);
	channel.version = (channel.version ?? 0) + 1;
	return () => {
		if (channel.statusActions?.get(id) !== action) return;
		channel.statusActions.delete(id);
		if (channel.focusedStatus === id) channel.focusedStatus = undefined;
		channel.version = (channel.version ?? 0) + 1;
	};
}

/** The clickable status drawn at `column` (relative to the line start) in the latest render. */
export function statusAt(column: number): string | undefined {
	const channel = statusLineChannel();
	if (!channel.statusActions?.size || !channel.regions) return undefined;
	for (const region of channel.regions) {
		if (column >= region.start && column < region.end && channel.statusActions.has(region.id)) return region.id;
	}
	return undefined;
}

/** Run the action of the clickable status at `column`; true when one ran. */
export function activateStatusAt(column: number): boolean {
	const id = statusAt(column);
	const action = id === undefined ? undefined : statusLineChannel().statusActions?.get(id);
	if (!action) return false;
	action.activate();
	return true;
}
