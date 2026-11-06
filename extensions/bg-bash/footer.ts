/**
 * The footer indicator: `● 2 running · ○1 ○1`. Updated from job state changes only (never output or
 * timers), and pushed to `ctx.ui.setStatus` only when its text actually changes.
 */
import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { plainStatusTheme, setThemedStatus } from "@stagefright5/pi-extension-utils";
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
	private readonly ui: Pick<ExtensionUIContext, "setStatus">;

	constructor(manager: JobManager, ui: Pick<ExtensionUIContext, "setStatus">) {
		this.manager = manager;
		this.ui = ui;
	}

	update(): void {
		const counts = this.manager.counts();
		const text = jobsStatusText(counts, plainStatusTheme);
		if (text === this.last) return;
		this.last = text;
		setThemedStatus(this.ui, STATUS_ID, text ? (theme) => jobsStatusText(counts, theme)! : undefined);
	}

	clear(): void {
		if (this.last === undefined) return;
		this.last = undefined;
		setThemedStatus(this.ui, STATUS_ID, undefined);
	}
}
