import { highlightCode, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Spacer, Text, type Component } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { codeKey, type Summary, type SummaryStore } from "./explain.ts";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type RenderContext = Parameters<CallRenderer>[2];
export type Phase = "writing" | "executing" | "summarizing" | "done";

/** Each loading phase has its own animation. Frames follow the wall clock, so redraws only advance them. */
export const SPINNERS: Record<Exclude<Phase, "done">, { frames: string[]; ms: number }> = {
	writing: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], ms: 80 },
	executing: { frames: ["◐", "◓", "◑", "◒"], ms: 120 },
	summarizing: { frames: ["∙∙∙", "●∙∙", "∙●∙", "∙∙●"], ms: 160 },
};
const TICK_MS = 80;
/** Stop redrawing a row that never settles, e.g. one orphaned by a crash. */
const MAX_ANIMATION_MS = 10 * 60_000;

type RowState = {
	invalidate?: () => void;
	ticker?: ReturnType<typeof setInterval>;
	tickerSince?: number;
	nativeStarted?: boolean;
	startedAt?: number;
	endedAt?: number;
	highlighted?: { code: string; text: string };
	/** Written by renderResult, read lazily by the call header, which renders before it. */
	failures?: Failure[];
};
export type Failure = { label: string; error: string };
const MAX_COLLAPSED_FAILURES = 3;
const MAX_ARG_CHARS = 60;
const ARG_FIELDS = ["command", "path", "file_path", "url", "query", "pattern", "name"];
const rowKey = Symbol("codemode-explain-row");
const tickers = new Set<ReturnType<typeof setInterval>>();

function row(context: RenderContext): RowState {
	return ((context.state as Record<symbol, RowState>)[rowKey] ??= {});
}

/** Clears every running animation; called on session shutdown. */
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

export function headerText(theme: Theme, phase: Phase, summary: Summary | undefined, failed: boolean): string {
	const label = (text: string) => theme.fg("toolTitle", theme.bold(text));
	const spin = (p: Exclude<Phase, "done">) => theme.fg("accent", frame(p));
	const done = summary?.status === "done" ? summary.text : undefined;
	// Beside a summary, the label steps back so the summary is the brightest part of the header.
	const withSummary = (text: string, summaryText: string) =>
		`${theme.fg("muted", text)} ${theme.fg("accent", summaryText)}`;
	switch (phase) {
		case "writing":
			return `${spin("writing")} ${label("Writing codemode tool call…")}`;
		case "executing":
			return done
				? `${spin("executing")} ${withSummary("Executing code:", done)}`
				: `${spin("executing")} ${label("Executing code…")}`;
		default: {
			const mark = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
			const title = failed ? "Codemode failed" : "Codemode executed";
			if (phase === "summarizing") return `${mark} ${label(`${title}:`)} ${spin("summarizing")}`;
			return done ? `${mark} ${withSummary(`${title}:`, done)}` : `${mark} ${label(title)}`;
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
): string {
	const raw = (details as { calls?: unknown } | undefined)?.calls;
	const calls: NestedCall[] = Array.isArray(raw) ? raw : [];
	const count = (status: string) => calls.filter((call) => call.status === status).length;
	const parts: string[] = [];
	if (calls.length) parts.push(theme.fg("muted", `${calls.length} ${calls.length === 1 ? "call" : "calls"}`));
	if (count("running")) parts.push(theme.fg("warning", `${count("running")} running`));
	if (count("error")) parts.push(theme.fg("error", `${count("error")} failed`));
	if (count("cancelled")) parts.push(theme.fg("muted", `${count("cancelled")} cancelled`));
	if (context.isError) parts.push(theme.fg("error", "script failed"));
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

/** The argument that identifies a call: a command, path, URL, or query; otherwise the first string. */
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
		// Arguments over pi's record limit are truncated JSON: show them as text.
	}
	text = singleLine(text);
	return text.length > MAX_ARG_CHARS ? `${text.slice(0, MAX_ARG_CHARS - 1).trimEnd()}…` : text;
}

/** The tool's own first error line, with bash's trailing exit code folded in. */
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

/** Failed nested calls, then the script's own error when the whole script failed. */
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
		// Rejected input (e.g. a bad options line) has no script header or "Script error:" line.
		const fallback = text
			.split("\n")
			.map((line) => line.trim())
			.find((line) => line && !/^(Script (completed|failed)|Wall time .*|Output:)$/.test(line));
		failures.push({ label: "Script error:", error: singleLine(thrown || fallback || "failed") });
	}
	return failures;
}

/** ANSI faint (SGR 2), closed with SGR 22, which leaves colors alone. */
export const faint = (text: string) => `\x1b[2m${text}\x1b[22m`;

export function failureText(theme: Theme, failures: readonly Failure[], expanded: boolean): string {
	// The script's own error is always shown and does not count toward the collapsed limit.
	const calls = failures.filter((f) => f.label !== "Script error:");
	const script = failures.filter((f) => f.label === "Script error:");
	const shown = expanded ? calls : calls.slice(0, MAX_COLLAPSED_FAILURES);
	const mark = theme.fg("error", "✗");
	// Dimmer than the muted header label in any theme: dim color plus the terminal's faint style.
	const quiet = (text: string) => faint(theme.fg("dim", text));
	const lines = shown.map((f) => `${mark} ${quiet(`${f.label} — ${f.error}`)}`);
	if (shown.length < calls.length) lines.push(quiet(`+${calls.length - shown.length} more failed`));
	for (const f of script) lines.push(`${mark} ${quiet(`${f.label} ${f.error}`)}`);
	return lines.join("\n");
}

/** Reads failures when drawn, because pi renders the call before the result that reports them. */
class FailureLines implements Component {
	constructor(
		private readonly state: RowState,
		private readonly theme: Theme,
		private readonly expanded: boolean,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const failures = this.state.failures ?? [];
		return failures.length ? new Text(failureText(this.theme, failures, this.expanded), 0, 0).render(width) : [];
	}
}

/** A replaceable stack of children; the native component is kept separately for its own render slot. */
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

export function explainRenderers(native: ToolRenderers, store: SummaryStore): ToolRenderers {
	return {
		...native,
		renderCall(args, theme: Theme, context) {
			const slot = context.lastComponent instanceof Slot ? context.lastComponent : new Slot();
			const state = row(context);
			const code = (args as { code?: unknown } | undefined)?.code;
			if (typeof code !== "string") {
				// Invalid arguments keep pi's own error presentation.
				slot.native = native.renderCall?.(args, theme, { ...context, lastComponent: slot.native });
				slot.children = slot.native ? [slot.native] : [];
				return slot;
			}
			if (context.executionStarted) {
				state.startedAt ??= Date.now();
				// Run the native renderer once so expanded results keep pi's elapsed-time line.
				if (!state.nativeStarted) native.renderCall?.(args, theme, { ...context, lastComponent: undefined });
				state.nativeStarted = true;
			}
			if (!context.isPartial) state.endedAt ??= Date.now();
			const key = context.argsComplete ? codeKey(code) : undefined;
			const summary = key ? store.get(key) : undefined;
			if (key && summary?.status === "pending") store.wait(key, context.invalidate);
			const phase = phaseOf(context, summary);
			animate(state, context, phase !== "done");
			slot.children = [
				new Text(headerText(theme, phase, summary, context.isError), 0, 0),
				new FailureLines(state, theme, context.expanded),
			];
			if (context.expanded && code.trim())
				slot.children.push(new Spacer(1), new Text(highlighted(state, code), 0, 0));
			return slot;
		},
		renderResult(result, options, theme, context) {
			const slot = context.lastComponent instanceof Slot ? context.lastComponent : new Slot();
			// Always render natively too, so pi's own timers start and stop with the row.
			slot.native = native.renderResult?.(result, options, theme, { ...context, lastComponent: slot.native });
			row(context).failures = failuresOf(result.content, result.details, context.isError);
			if (options.expanded) {
				slot.children = slot.native ? [slot.native] : [];
				return slot;
			}
			const status = statusText(
				theme,
				result.details,
				{ ...context, isPartial: options.isPartial },
				row(context),
			);
			slot.children = status ? [new Spacer(1), new Text(status, 0, 0)] : [];
			return slot;
		},
	};
}
