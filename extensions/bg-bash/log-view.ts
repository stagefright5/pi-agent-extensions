/**
 * Full-screen log of one job, inside the `/jobs` overlay.
 *
 * Bounded work per frame: the log file is read incrementally (new bytes only), at most
 * LOG_VIEW_MAX_LINES lines are kept, new lines are wrapped once and appended to a per-width cache,
 * and each frame only styles the visible slice.
 */
import { open } from "node:fs/promises";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TUI,
} from "@earendil-works/pi-tui";
import { cleanOutput, formatDuration, type Job } from "./jobs.ts";

export const LOG_VIEW_MAX_LINES = 20_000;
/** When over the cap, drop down to this many lines so trimming (and re-wrapping) stays rare. */
const LOG_VIEW_KEEP_LINES = 15_000;
/** A long log opens at its last few megabytes. */
export const LOG_VIEW_INITIAL_BYTES = 4 * 1024 * 1024;
const READ_CHUNK = 1024 * 1024;

/** Printable ASCII only: one column per character. */
const ASCII = /^[\x20-\x7e]*$/u;

/** Wrap one clean (escape-free) line into rows of at most `width` columns. */
export function wrapLine(line: string, width: number, out: string[]): void {
	if (ASCII.test(line)) {
		if (line.length <= width) {
			out.push(line);
			return;
		}
		for (let at = 0; at < line.length; at += width) out.push(line.slice(at, at + width));
		return;
	}
	if (visibleWidth(line) <= width) out.push(line);
	else out.push(...wrapTextWithAnsi(line, width));
}

/** Complete, cleaned log lines, read incrementally from a growing file. */
export class LogLines {
	readonly lines: string[] = [];
	/** Lines dropped from the front so far (cap or a cut initial read). */
	dropped = 0;
	/** The first read skipped the start of a long file. */
	cut = false;
	private partial = "";
	private offset = 0;
	private decoder = new TextDecoder("utf-8");
	private loading: Promise<boolean> | undefined;
	private again = false;
	private readonly path: string;

	constructor(path: string) {
		this.path = path;
	}

	/** Append decoded text; returns whether lines were dropped from the front. */
	append(text: string): boolean {
		const parts = (this.partial + text).split("\n");
		this.partial = parts.pop() ?? "";
		for (const part of parts) this.lines.push(cleanOutput(part));
		if (this.lines.length <= LOG_VIEW_MAX_LINES) return false;
		const drop = this.lines.length - LOG_VIEW_KEEP_LINES;
		this.lines.splice(0, drop);
		this.dropped += drop;
		return true;
	}

	/** The unterminated last line, shown as the final row while the job writes it. */
	get pending(): string {
		return cleanOutput(this.partial);
	}

	/** Read bytes appended since the last call. Concurrent calls coalesce into one follow-up read. */
	load(): Promise<boolean> {
		if (this.loading) {
			this.again = true;
			return this.loading;
		}
		this.loading = this.read().finally(() => {
			this.loading = undefined;
			if (this.again) {
				this.again = false;
				void this.load();
			}
		});
		return this.loading;
	}

	private async read(): Promise<boolean> {
		let handle;
		try {
			handle = await open(this.path, "r");
		} catch {
			return false;
		}
		try {
			const { size } = await handle.stat();
			if (this.offset === 0 && size > LOG_VIEW_INITIAL_BYTES) {
				this.offset = size - LOG_VIEW_INITIAL_BYTES;
				this.cut = true;
			}
			let trimmed = false;
			let skipFirst = this.cut && this.lines.length === 0 && this.dropped === 0 && this.partial === "";
			const buffer = Buffer.alloc(READ_CHUNK);
			while (this.offset < size) {
				const { bytesRead } = await handle.read(
					buffer,
					0,
					Math.min(READ_CHUNK, size - this.offset),
					this.offset,
				);
				if (bytesRead === 0) break;
				this.offset += bytesRead;
				let text = this.decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
				if (skipFirst) {
					// Starting mid-file: drop the partial first line.
					const newline = text.indexOf("\n");
					if (newline < 0) continue;
					text = text.slice(newline + 1);
					skipFirst = false;
				}
				trimmed = this.append(text) || trimmed;
			}
			return trimmed;
		} finally {
			await handle.close();
		}
	}
}

export interface LogViewOptions {
	job: Job;
	tui: TUI;
	theme: () => Theme;
	keybindings: Pick<KeybindingsManager, "matches">;
	height: () => number;
	onBack: () => void;
	onClose: () => void;
}

export class LogView implements Component {
	private readonly options: LogViewOptions;
	readonly model: LogLines;
	private wrapped: string[] = [];
	private wrappedWidth = -1;
	private wrappedLines = 0;
	private follow = true;
	private top = 0;
	private disposed = false;

	constructor(options: LogViewOptions) {
		this.options = options;
		this.model = new LogLines(options.job.logPath ?? "");
		void this.refresh();
	}

	/** Pull new output from the log file (call on the job's output and state changes). */
	async refresh(): Promise<void> {
		const trimmed = await this.model.load();
		if (this.disposed) return;
		if (trimmed) this.wrappedWidth = -1;
		this.options.tui.requestRender();
	}

	dispose(): void {
		this.disposed = true;
	}

	invalidate(): void {}

	private pageSize(): number {
		return Math.max(1, this.options.height() - 6);
	}

	/** Wrap only lines added since the last frame; rebuild when the width changes or lines were trimmed. */
	private rows(width: number): readonly string[] {
		if (width !== this.wrappedWidth) {
			this.wrapped = [];
			this.wrappedLines = 0;
			this.wrappedWidth = width;
		}
		const lines = this.model.lines;
		for (; this.wrappedLines < lines.length; this.wrappedLines++)
			wrapLine(lines[this.wrappedLines]!, width, this.wrapped);
		return this.wrapped;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.options.theme();
		const { job } = this.options;
		const contentWidth = Math.max(1, width - 1);
		const rows = this.rows(contentWidth);
		const pending: string[] = [];
		if (this.model.pending) wrapLine(this.model.pending, contentWidth, pending);
		const total = rows.length + pending.length;
		const page = this.pageSize();
		const maxTop = Math.max(0, total - page);
		if (this.follow) this.top = maxTop;
		this.top = Math.max(0, Math.min(this.top, maxTop));

		const rule = theme.fg("borderMuted", "─".repeat(width));
		const state =
			job.state === "running"
				? theme.fg("accent", `running ${formatDuration(job.elapsedMs())}`)
				: job.state === "exited" && job.exitCode === 0
					? theme.fg("success", `exit 0 · ${formatDuration(job.elapsedMs())}`)
					: theme.fg(
							"error",
							`${job.state === "exited" ? `exit ${job.exitCode}` : job.state} · ${formatDuration(job.elapsedMs())}`,
						);
		const lines = [
			rule,
			truncateToWidth(
				` ${theme.fg("accent", theme.bold(job.id))} · ${state} · ${theme.fg("dim", `pid ${job.pid ?? "?"}`)}`,
				width,
				"…",
			),
			truncateToWidth(` ${theme.fg("dim", job.command.replace(/\s+/gu, " "))}`, width, "…"),
			rule,
		];
		for (let row = this.top; row < this.top + page; row++) {
			const text = row < rows.length ? rows[row]! : (pending[row - rows.length] ?? "");
			lines.push(` ${theme.fg("toolOutput", text)}`);
		}
		const position = total === 0 ? "0/0" : `${this.top + 1}-${Math.min(this.top + page, total)}/${total}`;
		const earlier = this.model.dropped > 0 || this.model.cut ? " · earlier output in log file" : "";
		const help =
			width < 80
				? `${position} · f follow · esc back`
				: `${position}${earlier} · ↑↓ scroll · f follow ${this.follow ? "on" : "off"} · esc back · ctrl+c close`;
		lines.push(rule, truncateToWidth(` ${theme.fg("dim", help)}`, width, "…"));
		return lines;
	}

	handleInput(data: string): void {
		const { keybindings, tui } = this.options;
		const scroll = (delta: number) => {
			this.follow = false;
			this.top = Math.max(0, this.top + delta);
			tui.requestRender();
		};
		if (matchesKey(data, Key.ctrl("c"))) return this.options.onClose();
		if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, Key.left)) return this.options.onBack();
		if (keybindings.matches(data, "tui.select.up") || data === "k") return scroll(-1);
		if (keybindings.matches(data, "tui.select.down") || data === "j") return scroll(1);
		if (keybindings.matches(data, "tui.select.pageUp")) return scroll(-this.pageSize());
		if (keybindings.matches(data, "tui.select.pageDown") || matchesKey(data, Key.space))
			return scroll(this.pageSize());
		if (matchesKey(data, Key.home) || data === "g") {
			this.follow = false;
			this.top = 0;
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.end) || data === "G" || data === "f") {
			this.follow = data === "f" ? !this.follow : true;
			tui.requestRender();
		}
	}
}
