/**
 * `/jobs`: a pi-picker overlay of background jobs with a live log preview, plus a full log view.
 *
 * Render work is bounded: rows are cheap strings for the visible window; the preview is decoded once
 * per job output/state version (`previewKey`) from the in-memory tail; the 1 s tick runs only while
 * the overlay is open and a job is running; output events redraw only for the selected job.
 */
import { readFile } from "node:fs/promises";
import { copyToClipboard, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type Focusable, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { createPicker, type FilterGroup, type Picker } from "@stagefright5/pi-picker";
import { cleanOutput, formatDuration, lastLines, type Job, type JobManager } from "./jobs.ts";
import { LogView } from "./log-view.ts";

/** The panel fits its jobs, keeps room for a useful preview, and never exceeds half the terminal. */
const PANEL_HEIGHT = { fit: true, max: 0.5, min: 14 } as const;
const PREVIEW_LINES = 300;
const PREVIEW_BYTES = 32 * 1024;
const SEND_LINES = 80;

export function jobGlyph(job: Job): string {
	if (job.state === "running") return "●";
	if (job.unread) return "○";
	return job.state === "exited" && job.exitCode === 0 ? "✓" : "✗";
}

export function jobLabel(job: Job, now = Date.now()): string {
	const duration = formatDuration(job.elapsedMs(now));
	if (job.state === "running") return `running ${duration}`;
	if (job.state === "exited") return `exit ${job.exitCode} · ${duration}`;
	return `${job.state === "timed-out" ? "timed out" : "killed"} · ${duration}`;
}

/** Tail text for previews and messages: bounded, escape-free. */
export function jobTail(job: Job, lines = PREVIEW_LINES): string {
	const text = job.tailText();
	return cleanOutput(lastLines(text.length > PREVIEW_BYTES ? text.slice(-PREVIEW_BYTES) : text, lines));
}

export interface JobsBrowserOptions {
	tui: TUI;
	theme: () => Theme;
	keybindings: KeybindingsManager;
	manager: JobManager;
	done: () => void;
	/** Send text to the agent as a user message. */
	sendToAgent: (text: string) => void;
	copy?: (text: string) => Promise<void>;
	/** Overrides the 1 s tick for tests. */
	tickMs?: number;
}

export class JobsBrowser implements Component, Focusable {
	private readonly options: JobsBrowserOptions;
	readonly picker: Picker<Job>;
	private logView: LogView | undefined;
	private readonly previews = new Map<Job, { key: string; text: string }>();
	private readonly offChange: () => void;
	private tick: NodeJS.Timeout | undefined;
	private _focused = false;
	private disposed = false;

	constructor(options: JobsBrowserOptions) {
		this.options = options;
		const { manager, tui } = options;
		const copy = options.copy ?? copyToClipboard;
		const filters: FilterGroup<Job>[] = [
			{
				id: "status",
				label: "Status",
				options: [
					{ id: "running", label: "running", test: (job) => job.state === "running" },
					{ id: "finished", label: "finished", test: (job) => job.state !== "running" },
					{
						id: "failed",
						label: "failed",
						test: (job) => job.state !== "running" && !(job.state === "exited" && job.exitCode === 0),
					},
					{ id: "unread", label: "unread", test: (job) => job.unread },
				],
			},
		];
		this.picker = createPicker<Job>({
			tui,
			theme: options.theme,
			keybindings: options.keybindings,
			title: "Background jobs",
			items: manager.list(),
			text: (job) => `${job.id} ${job.command} ${job.cwd}`,
			row: (job) => ({
				primary: `${jobGlyph(job)} ${job.id} ${jobLabel(job)}`,
				secondary: job.command.replace(/\s+/gu, " "),
			}),
			layout: "column",
			preview: (job) => this.preview(job),
			previewKey: (job) => `${job.outputVersion}:${job.stateVersion}`,
			previewTail: true,
			filters,
			multiSelect: true,
			emptyMessage: "No matching jobs",
			height: PANEL_HEIGHT,
			actions: [
				{
					id: "open",
					label: "log",
					key: "tui.select.confirm",
					primary: true,
					run: (jobs) => this.openLog(jobs[0]!),
				},
				{
					id: "kill",
					label: "kill",
					key: "ctrl+k",
					confirm: (jobs) =>
						`Press ⌃K again to stop ${jobs.length === 1 ? jobs[0]!.id : `${jobs.length} jobs`}`,
					run: (jobs, context) => {
						const stopped = jobs.filter((job) => job.kill("user")).length;
						context.notify(
							stopped ? `Stopping ${stopped} job${stopped === 1 ? "" : "s"}` : "Already finished",
						);
					},
				},
				{
					id: "copy",
					label: "copy log",
					key: "ctrl+y",
					run: async (jobs, context) => {
						const texts = await Promise.all(
							jobs.map((job) =>
								job.logPath
									? readFile(job.logPath, "utf8").catch(() => job.tailText())
									: job.tailText(),
							),
						);
						await copy(texts.map(cleanOutput).join("\n\n"));
						context.notify(jobs.length === 1 ? "Copied log" : `Copied ${jobs.length} logs`);
					},
				},
				{
					id: "path",
					label: "copy path",
					key: "ctrl+p",
					run: async (jobs, context) => {
						await copy(jobs.map((job) => job.logPath ?? "").join("\n"));
						context.notify("Copied log path");
					},
				},
				{
					id: "remove",
					label: "remove",
					key: "ctrl+d",
					run: (jobs, context) => {
						const finished = jobs.filter((job) => job.state !== "running");
						for (const job of finished) {
							manager.remove(job);
							this.previews.delete(job);
						}
						context.remove(finished);
						const skipped = jobs.length - finished.length;
						context.notify(skipped ? `Kept ${skipped} running` : `Removed ${finished.length}`);
					},
				},
				{
					id: "read",
					label: "mark read",
					key: "ctrl+r",
					run: (_jobs, context) => {
						for (const job of manager.list()) job.markRead();
						context.notify("Marked all read");
					},
				},
				{
					id: "send",
					label: "send to agent",
					key: "ctrl+s",
					run: (jobs, context) => {
						const parts = jobs.map(
							(job) =>
								`Background job ${job.id} (${jobLabel(job)}): ${job.command}\nLog: ${job.logPath ?? "(none)"}\n\`\`\`\n${jobTail(job, SEND_LINES)}\n\`\`\``,
						);
						options.sendToAgent(parts.join("\n\n"));
						context.close();
					},
				},
			],
			onClose: () => options.done(),
		});
		this.offChange = manager.onChange((job, change) => {
			// Output only matters when it is on screen: the selected job's preview or the open log.
			if (change === "output") {
				if (this.logView) {
					if (job === this.logJob) void this.logView.refresh();
					return;
				}
				if (job !== this.picker.selectedItem) return;
			} else if (this.logView && job === this.logJob) {
				void this.logView.refresh();
			}
			if (change === "state") this.ensureTick();
			tui.requestRender();
		});
		this.ensureTick();
	}

	private logJob: Job | undefined;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.picker.focused = value && !this.logView;
	}

	/** Elapsed times change every second while something runs; otherwise no timer at all. */
	private ensureTick(): void {
		if (this.disposed || this.tick) return;
		if (!this.options.manager.list().some((job) => job.state === "running")) return;
		this.tick = setInterval(() => {
			if (!this.options.manager.list().some((job) => job.state === "running")) {
				clearInterval(this.tick);
				this.tick = undefined;
			}
			this.options.tui.requestRender();
		}, this.options.tickMs ?? 1000);
		this.tick.unref();
	}

	/** Header plus the last lines, decoded once per output/state version. */
	private preview(job: Job): string {
		const key = `${job.outputVersion}:${job.stateVersion}`;
		const cached = this.previews.get(job);
		if (cached?.key === key) return cached.text;
		const header = [
			`${jobLabel(job)} · pid ${job.pid ?? "?"}`,
			`cwd ${job.cwd}`,
			`log ${job.logPath ?? "(none)"}`,
			"",
		].join("\n");
		const text = header + (jobTail(job) || "(no output yet)");
		this.previews.set(job, { key, text });
		return text;
	}

	private openLog(job: Job): void {
		if (!job.logPath) return;
		job.markRead();
		this.logJob = job;
		this.logView = new LogView({
			job,
			tui: this.options.tui,
			theme: this.options.theme,
			keybindings: this.options.keybindings,
			height: () => this.overlayHeight(),
			onBack: () => this.closeLog(),
			onClose: () => this.options.done(),
		});
		this.picker.focused = false;
		this.options.tui.requestRender();
	}

	private closeLog(): void {
		this.logView?.dispose();
		this.logView = undefined;
		this.logJob = undefined;
		this.picker.focused = this._focused;
		this.options.tui.requestRender();
	}

	/** The log view uses the panel's maximum height. */
	private overlayHeight(): number {
		return Math.max(8, Math.floor(this.options.tui.terminal.rows * PANEL_HEIGHT.max));
	}

	invalidate(): void {
		this.picker.invalidate();
	}

	handleInput(data: string): void {
		if (this.logView) return this.logView.handleInput(data);
		if (matchesKey(data, Key.ctrl("c"))) return this.options.done();
		this.picker.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent) {
		return this.logView ? undefined : this.picker.handleMouse(event);
	}

	render(width: number): string[] {
		if (this.logView) return this.logView.render(width);
		const lines = this.picker.render(width);
		// Selecting a finished job counts as reading it (clears its footer circle).
		const selected = this.picker.selectedItem;
		if (selected?.unread) selected.markRead();
		return lines;
	}

	dispose(): void {
		this.disposed = true;
		this.offChange();
		clearInterval(this.tick);
		this.tick = undefined;
		this.logView?.dispose();
		this.previews.clear();
	}
}
