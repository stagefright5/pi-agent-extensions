/**
 * Compact Status Bar Extension
 *
 * Replaces pi's multi-line built-in footer with one line:
 *   cwd · branch · extension statuses       model · thinking · context · cost
 *
 * Statuses registered with `registerStatusAction` are clickable, and Alt+S moves keyboard focus
 * onto them (←/→ move, Enter opens, Esc leaves).
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, Key, matchesKey, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { layoutStatusBarRegions, type StatusLayoutResult } from "./status-bar-format.ts";
import { createSessionCostReader } from "./session-cost.ts";
import { activateStatusAt, statusLineChannel } from "./status-line.ts";

function formatCwd(cwd: string): string {
	const home = homedir();
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function formatContextWindow(tokens: number): string {
	return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`;
}

function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/** Keyboard focus on clickable footer statuses, active only between Alt+S and the next exit. */
class StatusNavigation {
	private unsubscribe: (() => void) | undefined;
	private readonly requestRender: () => void;

	constructor(requestRender: () => void) {
		this.requestRender = requestRender;
	}

	get active(): boolean {
		return this.unsubscribe !== undefined;
	}

	/** Clickable statuses in display order, limited to those visible in the latest line. */
	private targets(): string[] {
		const channel = statusLineChannel();
		const actions = channel.statusActions;
		if (!actions?.size) return [];
		return (channel.regions ?? []).map((region) => region.id).filter((id) => actions.has(id));
	}

	private focus(id: string | undefined): void {
		const channel = statusLineChannel();
		if (channel.focusedStatus === id) return;
		channel.focusedStatus = id;
		channel.version = (channel.version ?? 0) + 1;
		this.requestRender();
	}

	enter(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (this.active) {
			this.exit();
			return;
		}
		const targets = this.targets();
		if (targets.length === 0) {
			ctx.ui.notify("No clickable footer statuses", "info");
			return;
		}
		this.focus(targets[0]);
		// Listen only while navigating, so ordinary typing never passes through this handler.
		this.unsubscribe = ctx.ui.onTerminalInput((data) => this.handleInput(data));
	}

	exit(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.focus(undefined);
	}

	private move(delta: number): void {
		const targets = this.targets();
		if (targets.length === 0) return this.exit();
		const current = targets.indexOf(statusLineChannel().focusedStatus ?? "");
		this.focus(targets[(Math.max(0, current) + delta + targets.length) % targets.length]);
	}

	/** Consumes navigation keys; any other key leaves navigation and reaches the app unchanged. */
	handleInput(data: string): { consume: true } | undefined {
		if (isKeyRelease(data)) return undefined;
		if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) {
			this.move(-1);
			return { consume: true };
		}
		if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
			this.move(1);
			return { consume: true };
		}
		if (matchesKey(data, Key.enter)) {
			const channel = statusLineChannel();
			const action = channel.statusActions?.get(channel.focusedStatus ?? "");
			this.exit();
			action?.activate();
			return { consume: true };
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.alt("s"))) {
			this.exit();
			return { consume: true };
		}
		this.exit();
		return undefined;
	}
}

/** Focus marker: selection surface plus underline, then the action verb. */
function focusedStatus(theme: Theme, text: string, label: string): string {
	return theme.bg("selectedBg", theme.underline(text)) + theme.fg("dim", ` ⏎ ${label}`);
}

export default function statusBarExtension(pi: ExtensionAPI): void {
	let tui: TUI | undefined;
	const navigation = new StatusNavigation(() => tui?.requestRender());

	pi.registerShortcut(Key.alt("s"), {
		description: "Focus clickable footer statuses",
		handler: (ctx) => navigation.enter(ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((footerTui, _theme, footerData) => {
			tui = footerTui;
			const getCost = createSessionCostReader();
			const unsubscribeFromBranchChanges = footerData.onBranchChange(() => footerTui.requestRender());
			const channel = statusLineChannel();
			// The footer is drawn on every frame; rebuild the line only when an input changes.
			let cached: { key: string; theme: Theme; result: StatusLayoutResult } | undefined;

			const renderLine = (width: number, extras?: readonly string[]): string => {
				const theme = ctx.ui.theme;
				const cwd = formatCwd(ctx.sessionManager.getCwd());
				const branch = footerData.getGitBranch();
				const usage = ctx.getContextUsage();
				const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const extensionStatuses = footerData.getExtensionStatuses();
				const thinking = ctx.model?.reasoning ? (ctx.thinkingLevel ?? pi.getThinkingLevel()) : "off";
				const cost = getCost(ctx.sessionManager);
				let statusKey = "";
				for (const [id, text] of extensionStatuses) statusKey += `${id}\u0001${text}\u0002`;
				const key = [
					width,
					extras?.join("\u0001") ?? "",
					cwd,
					branch ?? "",
					usage?.percent ?? "",
					contextWindow,
					ctx.model?.provider ?? "",
					ctx.model?.name ?? "",
					thinking,
					cost,
					statusKey,
					channel.version ?? 0,
				].join("\u0000");
				if (cached?.key !== key || cached.theme !== theme) {
					cached = { key, theme, result: layoutLine(theme, width, extras) };
				}
				channel.regions = cached.result.regions;
				return cached.result.line;

				function layoutLine(theme: Theme, width: number, extras?: readonly string[]): StatusLayoutResult {
					const separator = theme.fg("borderMuted", " · ");
					const branchLabel = branch ? separator + theme.fg("accent", sanitizeStatusText(branch)) : "";
					const location = theme.fg("muted", sanitizeStatusText(cwd)) + branchLabel;
					const shortLocation = theme.fg("muted", sanitizeStatusText(basename(cwd) || cwd)) + branchLabel;
					const windowLabel = formatContextWindow(contextWindow);
					const contextText =
						usage?.percent == null ? `?/${windowLabel}` : `${usage.percent.toFixed(1)}%/${windowLabel}`;
					const styledContext =
						usage?.percent != null && usage.percent > 90
							? theme.fg("error", contextText)
							: usage?.percent != null && usage.percent > 70
								? theme.fg("warning", contextText)
								: theme.fg("dim", contextText);

					const fast = extensionStatuses.get("fast") ? theme.fg("accent", "⚡︎") : "";
					const statuses: string[] = [];
					const statusIds: string[] = [];
					const focused = channel.focusedStatus;
					for (const [id, raw] of [...extensionStatuses.entries()].sort(([left], [right]) =>
						left.localeCompare(right),
					)) {
						if (id === "fast") continue;
						const text = sanitizeStatusText(raw);
						if (!text) continue;
						const action = id === focused ? channel.statusActions?.get(id) : undefined;
						statuses.push(action ? focusedStatus(theme, text, action.label) : text);
						statusIds.push(id);
					}
					const modelName = ctx.model ? sanitizeStatusText(ctx.model.name) : "";
					const effort = theme.fg("dim", thinking) + (fast ? separator + fast : "");
					const model = ctx.model
						? theme.fg("dim", `${ctx.model.provider}/`) + theme.fg("muted", modelName) + separator + effort
						: "";
					return layoutStatusBarRegions(
						{
							location,
							shortLocation,
							model,
							shortModel: modelName ? theme.fg("muted", modelName) + separator + effort : "",
							context: styledContext,
							cost: theme.fg("dim", `$${cost.toFixed(3)}`),
							statuses,
							statusIds,
							separator,
						},
						width,
						extras,
					);
				}
			};
			channel.render = renderLine;

			return {
				dispose() {
					unsubscribeFromBranchChanges();
					if (channel.render === renderLine) {
						channel.render = undefined;
						channel.regions = undefined;
					}
					if (tui === footerTui) tui = undefined;
				},
				invalidate() {
					cached = undefined;
				},
				render(width: number): string[] {
					// An editor drawing this line in its own footer (Prompt Truly Mine) replaces this row.
					if (channel.host?.hostsStatusLine()) return [];
					return [renderLine(width)];
				},
				/** Clicks hit-test the regions of the latest render; nothing is re-laid out. */
				handleMouse(event: TuiMouseEvent) {
					if (event.type !== "click" || event.button !== "left") return undefined;
					if (channel.host?.hostsStatusLine()) return undefined;
					return activateStatusAt(event.x) ? { handled: true } : undefined;
				},
			};
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		navigation.exit();
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});
}
