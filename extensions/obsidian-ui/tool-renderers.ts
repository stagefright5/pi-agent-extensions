import { keyHint, type Theme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { isAbsolute, relative } from "node:path";

type CallRenderer = NonNullable<ToolRenderers["renderCall"]>;
type ResultRenderer = NonNullable<ToolRenderers["renderResult"]>;
type RenderContext = Parameters<CallRenderer>[2];
type ToolResult = Parameters<ResultRenderer>[0];
type RowState = { phase?: "streaming" | "success" | "error"; summary?: string };
const rowKey = Symbol("obsidian-ui-row");

function rowState(context: RenderContext): RowState {
	return (context.state[rowKey] ??= {});
}

export function singleLine(value: unknown): string {
	return typeof value === "string" ? stripVTControlCharacters(value).replace(/\s+/gu, " ").trim() : "";
}

export function callSubject(name: string, raw: unknown, cwd: string): string {
	const args = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	let path = singleLine(args.path ?? args.file_path);
	if (isAbsolute(path)) {
		const local = relative(cwd, path);
		if (local && !local.startsWith("..") && local.length < path.length) path = local;
	}
	const pattern = singleLine(args.pattern ?? args.query);
	if (name === "bash" || name === "powershell") return singleLine(args.command);
	if (pattern) return [pattern, path].filter(Boolean).join(" · ");
	if (path) {
		const range = [
			typeof args.offset === "number" && Number.isFinite(args.offset) ? `from ${args.offset}` : "",
			typeof args.limit === "number" && Number.isFinite(args.limit) ? `limit ${args.limit}` : "",
		];
		return [path, ...range].filter(Boolean).join(" · ");
	}
	return singleLine(args.url ?? args.command ?? args.name);
}

export function formatDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function resultText(result: ToolResult): string {
	return result.content
		.map((block) =>
			block.type === "text" ? block.text : block.type === "image" ? `[image · ${block.mimeType}]` : "",
		)
		.filter(Boolean)
		.join("\n");
}

function resultSummary(result: ToolResult): string {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	const lines = text ? text.replace(/\n$/, "").split("\n").length : 0;
	const images = result.content.filter((block) => block.type === "image").length;
	return [
		lines ? `${lines} ${lines === 1 ? "line" : "lines"}` : "",
		images ? `${images} ${images === 1 ? "image" : "images"}` : "",
	]
		.filter(Boolean)
		.join(" · ");
}

/** Retain warnings even when the native renderer hides a successful collapsed read. */
export function resultNotices(result: ToolResult): string[] {
	const details = result.details as { truncation?: { truncated?: boolean }; fullOutputPath?: unknown } | undefined;
	const notices: string[] = [];
	if (details?.truncation?.truncated) notices.push("Output truncated by tool");
	if (typeof details?.fullOutputPath === "string") notices.push(`Full output: ${details.fullOutputPath}`);
	// Tool warnings may carry the only continuation offset or recovery path.
	for (const line of resultText(result).split("\n")) {
		if (
			/^\s*\[(?:showing lines|\d+ more lines in file\.|line \d+ is .* exceeds .* limit\.|truncated\b|output truncated\b|full output\b|first line\b)/i.test(
				line,
			) &&
			!notices.includes(line)
		)
			notices.push(line);
	}
	return notices;
}

class CallCard implements Component {
	constructor(
		private readonly name: string,
		private readonly args: unknown,
		private readonly theme: Theme,
		private readonly context: RenderContext,
		private readonly state: RowState,
		private readonly expandedBody?: Component,
	) {}
	invalidate(): void {
		this.expandedBody?.invalidate();
	}
	render(width: number): string[] {
		if (width <= 0) return [];
		if (this.expandedBody) return this.expandedBody.render(width);
		const { theme, context, state } = this;
		const failed = context.isError || state.phase === "error";
		const done = state.phase === "success";
		const marker = failed ? theme.fg("error", "✕") : done ? theme.fg("success", "✓") : theme.fg("accent", "·");
		const subject = callSubject(this.name, this.args, context.cwd);
		const label = `${marker} ${theme.fg("toolTitle", theme.bold(singleLine(this.name)))}${subject ? `  ${theme.fg("accent", subject)}` : ""}`;
		const meta = [
			failed ? "error" : state.phase === "streaming" ? "streaming" : "",
			state.summary,
			formatDuration(context.durationMs),
		]
			.filter(Boolean)
			.join(" · ");
		const metadata = theme.fg(failed ? "error" : "dim", meta);
		const metadataWidth = visibleWidth(metadata);
		if (meta && width >= metadataWidth + 24) {
			const left = truncateToWidth(label, width - metadataWidth - 2, "…");
			return [left + " ".repeat(width - visibleWidth(left) - metadataWidth) + metadata];
		}
		return [truncateToWidth(label, width, "…")];
	}
}

/** Wrap by visual rows, not source lines: a single huge JSON line must stay compact. */
class ResultPreview implements Component {
	private readonly body: Text;
	private readonly notices: Text;
	constructor(
		text: string,
		notices: string[],
		private readonly theme: Theme,
		private readonly expanded: boolean,
	) {
		this.body = new Text(
			text
				.split("\n")
				.map((line) => theme.fg("toolOutput", line))
				.join("\n"),
			0,
			0,
		);
		this.notices = new Text(notices.map((line) => theme.fg("warning", line)).join("\n"), 0, 0);
	}
	invalidate(): void {
		this.body.invalidate();
		this.notices.invalidate();
	}
	render(width: number): string[] {
		if (width <= 0) return [];
		const all = this.body.render(width);
		const limit = this.expanded ? all.length : 3;
		const lines = all.slice(0, limit);
		if (all.length > limit)
			lines.push(
				truncateToWidth(
					this.theme.fg("dim", `${all.length - limit} more rows · `) + keyHint("app.tools.expand", "expand"),
					width,
					"…",
				),
			);
		lines.push(...this.notices.render(width));
		return lines;
	}
}

/** Native components remain private to their own render slots across expansion and streaming. */
class DelegateSlot implements Component {
	child?: Component;
	delegate?: Component;
	invalidate(): void {
		this.child?.invalidate();
	}
	render(width: number): string[] {
		if (width <= 0) return [];
		return (this.child?.render(width) ?? []).map((line) => truncateToWidth(line, width, ""));
	}
}

export function compactRenderers(name: string, native?: ToolRenderers): ToolRenderers {
	return {
		// Keep the host shell: padding, background states, image display and click-to-expand remain native.
		renderShell: "default",
		renderCall(args, theme, context) {
			const slot = context.lastComponent instanceof DelegateSlot ? context.lastComponent : new DelegateSlot();
			if (context.expanded && native?.renderCall) {
				slot.delegate = native.renderCall(args, theme, { ...context, lastComponent: slot.delegate });
			}
			const expandedBody = context.expanded
				? native?.renderCall
					? slot.delegate
					: new Text(theme.fg("toolTitle", `${name}\n${JSON.stringify(args, null, 2) ?? ""}`), 0, 0)
				: undefined;
			slot.child = new CallCard(name, args, theme, context, rowState(context), expandedBody);
			return slot;
		},
		renderResult(result, options, theme, context) {
			const state = rowState(context);
			const wasError = state.phase === "error";
			state.phase = context.isError ? "error" : options.isPartial ? "streaming" : "success";
			state.summary = resultSummary(result);
			const slot = context.lastComponent instanceof DelegateSlot ? context.lastComponent : new DelegateSlot();
			// Native renderers can use different component classes for success/error.
			if (wasError !== context.isError) slot.delegate = undefined;
			// Native errors, syntax highlighting and search-limit notices remain intact.
			if (native?.renderResult && (name !== "read" || options.expanded || context.isError)) {
				slot.delegate = native.renderResult(result, options, theme, {
					...context,
					lastComponent: slot.delegate,
				});
				slot.child = slot.delegate;
			} else {
				slot.child = new ResultPreview(resultText(result), resultNotices(result), theme, options.expanded);
			}
			return slot;
		},
	};
}

/** Opaque identities only: these callbacks are compared, never invoked from this map. */
export interface NativeRendererIdentity {
	readonly renderCall?: unknown;
	readonly renderResult?: unknown;
}

/** Only replace proven native renderers. Custom, self-shell, edit and shell renderers keep their behavior. */
export function resolveRenderers(
	name: string,
	next: ToolRenderers | undefined,
	natives: ReadonlyMap<string, NativeRendererIdentity>,
): ToolRenderers | undefined {
	const original = natives.get(name);
	if (next?.renderShell === "self") return next;
	if (original && next?.renderCall === original.renderCall && next?.renderResult === original.renderResult) {
		return compactRenderers(name, next);
	}
	if (next?.renderCall || next?.renderResult) return next;
	return compactRenderers(name);
}
