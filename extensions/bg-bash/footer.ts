/**
 * The footer indicator: `● 2 running · ○1 ○1`. Updated from job state changes only (never output or
 * timers), and pushed to `ctx.ui.setStatus` only when its text actually changes.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { JobManager } from "./jobs.ts";

export const STATUS_ID = "bg-bash";

export type JobCounts = { running: number; unreadOk: number; unreadFailed: number };

/** Styled indicator text, or undefined when there is nothing to show. */
export function jobsStatusText(counts: JobCounts, theme: Pick<Theme, "fg">): string | undefined {
	const parts: string[] = [];
	if (counts.running > 0) parts.push(theme.fg("accent", `● ${counts.running} running`));
	const unread: string[] = [];
	if (counts.unreadOk > 0) unread.push(theme.fg("success", `○${counts.unreadOk}`));
	if (counts.unreadFailed > 0) unread.push(theme.fg("error", `○${counts.unreadFailed}`));
	if (unread.length) parts.push(unread.join(" "));
	return parts.length ? parts.join(theme.fg("dim", " · ")) : undefined;
}

/** Calls `setStatus` only when the rendered text changes. */
export class FooterStatus {
	private last: string | undefined;
	private readonly manager: JobManager;
	private readonly theme: () => Pick<Theme, "fg">;
	private readonly setStatus: (text: string | undefined) => void;

	constructor(manager: JobManager, theme: () => Pick<Theme, "fg">, setStatus: (text: string | undefined) => void) {
		this.manager = manager;
		this.theme = theme;
		this.setStatus = setStatus;
	}

	update(): void {
		const text = jobsStatusText(this.manager.counts(), this.theme());
		if (text === this.last) return;
		this.last = text;
		this.setStatus(text);
	}

	clear(): void {
		if (this.last === undefined) return;
		this.last = undefined;
		this.setStatus(undefined);
	}
}
