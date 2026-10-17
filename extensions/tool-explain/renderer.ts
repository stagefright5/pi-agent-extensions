import { highlightCode, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { toolKey, type Summary, type SummaryStore } from "./explain.ts";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderContext = Parameters<CallRenderer>[2];
export type Phase = "writing" | "executing" | "summarizing" | "done";

export const SPINNERS: Record<Exclude<Phase, "done">, { frames: string[]; ms: number }> = {
	writing: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], ms: 80 },
	executing: { frames: ["◐", "◓", "◑", "◒"], ms: 120 },
	summarizing: { frames: ["∙∙∙", "●∙∙", "∙●∙", "∙∙●"], ms: 160 },
};
const TICK_MS = 80;
// Limit redraws if a call never finishes.
const MAX_ANIMATION_MS = 10 * 60_000;

type RowState = {
	invalidate?: () => void;
	ticker?: ReturnType<typeof setInterval>;
	tickerSince?: number;
	nativeStarted?: boolean;
	startedAt?: number;
	endedAt?: number;
	highlighted?: { code: string; text: string };
	failures?: Failure[];
};
export type Failure = { label: string; error: string };
const MAX_COLLAPSED_FAILURES = 3;
const MAX_ARG_CHARS = 60;
const ARG_FIELDS = ["command", "path", "file_path", "url", "query", "pattern", "name"];
const rowKey = Symbol("tool-explain-row");
const tickers = new Set<ReturnType<typeof setInterval>>();

function row(context: RenderContext): RowState {
	return ((context.state as Record<symbol, RowState>)[rowKey] ??= {});
}

export function stopAnimations(): void {
	for (const ticker of tickers) clearInterval(ticker);
	tickers.clear();
}

function animate(state: RowState, context: RenderContext, on: boolean): void {
	state.invalidate = context.invalidate;
	const expired = state.tickerSince !== undefined && Date.now() - state.tickerSince > MAX_ANIMATION_MS;
	if (on && !state.ticker && !expired) {
		state.tickerSince ??= Date.now();
		state.ticker = setInterval(() => {
			if (state.tickerSince !== undefined && Date.now() - state.tickerSince > MAX_ANIMATION_MS)
				return animate(state, context, false);
			state.invalidate?.();
		}, TICK_MS);
		state.ticker.unref?.();
		tickers.add(state.ticker);
	} else if ((!on || expired) && state.ticker) {
		clearInterval(state.ticker);
		tickers.delete(state.ticker);
		state.ticker = undefined;
	}
}

export function phaseOf(context: Pick<RenderContext, "isPartial" | "argsComplete">, summary?: Summary): Phase {
	if (!context.isPartial) return summary?.status === "pending" ? "summarizing" : "done";
	return context.argsComplete ? "executing" : "writing";
}

function frame(phase: Exclude<Phase, "done">, now = Date.now()): string {
	const { frames, ms } = SPINNERS[phase];
	return frames[Math.floor(now / ms) % frames.length]!;
}

export function headerText(
	theme: Theme,
	phase: Phase,
	summary: Summary | undefined,
	failed: boolean,
	name = "codemode",
): string {
	const tool = theme.fg("toolTitle", theme.bold(name));
	const label = (before: string, after: string) => `${theme.fg("muted", before)}${tool}${theme.fg("muted", after)}`;
	const spin = (p: Exclude<Phase, "done">) => theme.fg("accent", frame(p));
	const done = summary?.status === "done" ? summary.text : undefined;
	const withSummary = (title: string, summaryText: string) => `${title} ${theme.fg("accent", summaryText)}`;
	switch (phase) {
		case "writing":
			return `${spin("writing")} ${label("Calling ", " tool…")}`;
		case "executing":
			return done
				? `${spin("executing")} ${withSummary(label("Running ", " tool:"), done)}`
				: `${spin("executing")} ${label("Running ", " tool…")}`;
		default: {
			const mark = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const status = ` tool ${failed ? "failed" : "completed"}`;
			if (phase === "summarizing") return `${mark} ${label("", `${status}:`)} ${spin("summarizing")}`;
			return done ? `${mark} ${withSummary(label("", `${status}:`), done)}` : `${mark} ${label("", status)}`;
		}
	}
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

type NestedCall = { status?: unknown };

export function statusText(
	theme: Theme,
	details: unknown,
	context: Pick<RenderContext, "isPartial" | "isError" | "durationMs">,
	timing: Pick<RowState, "startedAt" | "endedAt">,
	now = Date.now(),
	failureLabel = "script failed",
): string {
	const raw = (details as { calls?: unknown } | undefined)?.calls;
	const calls: NestedCall[] = Array.isArray(raw) ? raw : [];
	const count = (status: string) => calls.filter((call) => call.status === status).length;
	const parts: string[] = [];
	if (calls.length) parts.push(theme.fg("muted", `${calls.length} ${calls.length === 1 ? "call" : "calls"}`));
	if (count("running")) parts.push(theme.fg("warning", `${count("running")} running`));
	if (count("error")) parts.push(theme.fg("error", `${count("error")} failed`));
	if (count("cancelled")) parts.push(theme.fg("muted", `${count("cancelled")} cancelled`));
	if (context.isError) parts.push(theme.fg("error", failureLabel));
	if (!context.isPartial && context.durationMs !== undefined)
		parts.push(theme.fg("muted", `Took ${formatDuration(context.durationMs)}`));
	else if (timing.startedAt !== undefined)
		parts.push(
			theme.fg(
				"muted",
				`${context.isPartial ? "Elapsed" : "Took"} ${formatDuration((timing.endedAt ?? now) - timing.startedAt)}`,
			),
		);
	return parts.join(theme.fg("dim", " · "));
}

function singleLine(text: string): string {
	return stripVTControlCharacters(text).replace(/\s+/g, " ").trim();
}

/** Prefer a command, path, URL, or query. Fall back to the first string argument. */
export function shortArgs(raw: unknown): string {
	let text = typeof raw === "string" ? raw : "";
	try {
		const args = JSON.parse(text) as unknown;
		if (args && typeof args === "object") {
			const record = args as Record<string, unknown>;
			const key = ARG_FIELDS.find((field) => typeof record[field] === "string");
			const value = key ? record[key] : Object.values(record).find((v) => typeof v === "string");
			if (typeof value === "string") text = value;
		}
	} catch {
		// Pi truncates arguments over its record limit, which can leave invalid JSON.
	}
	text = singleLine(text);
	return text.length > MAX_ARG_CHARS ? `${text.slice(0, MAX_ARG_CHARS - 1).trimEnd()}…` : text;
}

/** Append bash's exit code to the first error line. */
export function errorLine(raw: unknown): string {
	const lines = (typeof raw === "string" ? stripVTControlCharacters(raw) : "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const exit = lines.map((line) => /^Command exited with code (\d+)$/.exec(line)?.[1]).find(Boolean);
	const first = lines.find((line) => !/^Command exited with code \d+$/.test(line));
	if (!first) return exit ? `exit ${exit}` : "failed";
	return exit ? `${first} (exit ${exit})` : first;
}

export function failuresOf(content: readonly { type: string; text?: string }[], details: unknown, isError: boolean) {
	const raw = (details as { calls?: unknown } | undefined)?.calls;
	const calls = (Array.isArray(raw) ? raw : []) as {
		name?: unknown;
		args?: unknown;
		status?: unknown;
		error?: unknown;
	}[];
	const failures: Failure[] = calls
		.filter((call) => call.status === "error")
		.map((call) => ({
			label: [singleLine(String(call.name ?? "tool")), shortArgs(call.args)].filter(Boolean).join(" "),
			error: errorLine(call.error),
		}));
	if (isError) {
		const text = content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");
		const thrown = /^Script error:\s*(.*)$/m.exec(text)?.[1]?.trim();
		// Input validation errors have no script header or "Script error:" line.
		const fallback = text
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line && !/^(Script (completed|failed)|Wall time .*|Output:)$/.test(line));
		failures.push({ label: "Script error:", error: singleLine(thrown || fallback || "failed") });
	}
	return failures;
}

/** SGR 22 resets faint styling without resetting colors. */
export const faint = (text: string) => `\x1b[2m${text}\x1b[22m`;

export function failureText(theme: Theme, failures: readonly Failure[], expanded: boolean): string {
	// The script error does not count toward the collapsed failure limit.
	const calls = failures.filter((f) => f.label !== "Script error:");
	const script = failures.filter((f) => f.label === "Script error:");
	const shown = expanded ? calls : calls.slice(0, MAX_COLLAPSED_FAILURES);
	const mark = theme.fg("error", "✗");
	const quiet = (text: string) => faint(theme.fg("dim", text));
	const lines = shown.map((f) => `${mark} ${quiet(`${f.label} — ${f.error}`)}`);
	if (shown.length < calls.length) lines.push(quiet(`+${calls.length - shown.length} more failed`));
	for (const f of script) lines.push(`${mark} ${quiet(`${f.label} ${f.error}`)}`);
	return lines.join("\n");
}

/** Read failures at draw time. Pi calls renderCall before renderResult populates them. */
class FailureLines implements Component {
	private readonly state: RowState;
	private readonly theme: Theme;
	private readonly expanded: boolean;

	constructor(state: RowState, theme: Theme, expanded: boolean) {
		this.state = state;
		this.theme = theme;
		this.expanded = expanded;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const failures = this.state.failures ?? [];
		return failures.length ? new Text(failureText(this.theme, failures, this.expanded), 0, 0).render(width) : [];
	}
}

/** Retain the native component for reuse when the row expands. */
class Slot implements Component {
	native?: Component;
	children: Component[] = [];
	invalidate(): void {
		this.native?.invalidate();
		for (const child of this.children) child.invalidate();
	}
	render(width: number): string[] {
		return this.children.flatMap((child) => child.render(width));
	}
}

function highlighted(state: RowState, code: string): string {
	if (state.highlighted?.code !== code) {
		const clean = code.replace(/\r/g, "").replace(/\t/g, "   ").trimEnd();
		state.highlighted = { code, text: highlightCode(clean, "javascript").join("\n") };
	}
	return state.highlighted.text;
}

export function explainRenderers(native: ToolRenderers, store: SummaryStore, name = "codemode"): ToolRenderers {
	const isCode = name === "codemode";
	return {
		...native,
		// Use Pi's box for the summary even when the native tool draws its own.
		renderShell: "default",
		renderCall(args, theme: Theme, context) {
			const slot = context.lastComponent instanceof Slot ? context.lastComponent : new Slot();
			const state = row(context);
			const code = (args as { code?: unknown } | undefined)?.code;
			if (isCode && typeof code !== "string") {
				slot.native = native.renderCall?.(args, theme, { ...context, lastComponent: slot.native });
				slot.children = slot.native ? [slot.native] : [];
				return slot;
			}
			if (!isCode) {
				// Hidden native components still need state and timer updates.
				slot.native = native.renderCall?.(args, theme, { ...context, lastComponent: slot.native });
			}
			if (context.executionStarted) {
				state.startedAt ??= Date.now();
				// Codemode's native call renderer initializes timing for the result.
				if (isCode && !state.nativeStarted)
					native.renderCall?.(args, theme, { ...context, lastComponent: undefined });
				state.nativeStarted = true;
			}
			if (!context.isPartial) state.endedAt ??= Date.now();
			const key = context.argsComplete ? toolKey(name, args) : undefined;
			const summary = key ? store.get(key) : undefined;
			if (key && summary?.status === "pending") store.wait(key, context.invalidate);
			const phase = phaseOf(context, summary);
			animate(state, context, phase !== "done");
			slot.children = [
				new Text(headerText(theme, phase, summary, context.isError, name), 0, 0),
				new FailureLines(state, theme, context.expanded),
			];
			if (context.expanded) {
				if (isCode && typeof code === "string" && code.trim())
					slot.children.push(new Spacer(1), new Text(highlighted(state, code), 0, 0));
				else if (!isCode)
					slot.children.push(
						new Spacer(1),
						slot.native ?? new Text(JSON.stringify(args, null, 2) ?? "", 0, 0),
					);
			}
			return slot;
		},
		renderResult(result, options, theme, context) {
			const slot = context.lastComponent instanceof Slot ? context.lastComponent : new Slot();
			// Native renderers must stop their timers even when their output is hidden.
			slot.native = native.renderResult?.(result, options, theme, { ...context, lastComponent: slot.native });
			const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
			row(context).failures = isCode
				? failuresOf(result.content, result.details, context.isError)
				: context.isError
					? [{ label: name, error: errorLine(text) }]
					: [];
			if (options.expanded) {
				slot.children = [slot.native ?? new Text(theme.fg("toolOutput", text), 0, 0)];
				return slot;
			}
			const status = statusText(
				theme,
				isCode ? result.details : undefined,
				{ ...context, isPartial: options.isPartial },
				row(context),
				Date.now(),
				isCode ? "script failed" : "tool failed",
			);
			slot.children = status ? [new Spacer(1), new Text(status, 0, 0)] : [];
			return slot;
		},
	};
}
