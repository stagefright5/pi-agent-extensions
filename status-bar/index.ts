/**
 * Compact Status Bar Extension
 *
 * Replaces pi's multi-line built-in footer with one line:
 *   cwd | context usage | cost | extension statuses
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

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

function getTotalCost(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			total += entry.message.usage.cost.total;
		}
	}
	return total;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export default function statusBarExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribeFromBranchChanges = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribeFromBranchChanges,
				invalidate() {},
				render(width: number): string[] {
					let cwd = formatCwd(ctx.sessionManager.getCwd());
					const branch = footerData.getGitBranch();
					if (branch) cwd += ` (${branch})`;

					const usage = ctx.getContextUsage();
					const contextWindow = formatContextWindow(usage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
					const contextText = usage?.percent == null ? `?/${contextWindow}` : `${usage.percent.toFixed(1)}%/${contextWindow}`;
					const styledContext =
						usage?.percent != null && usage.percent > 90
							? theme.fg("error", contextText)
							: usage?.percent != null && usage.percent > 70
								? theme.fg("warning", contextText)
								: theme.fg("dim", contextText);

					const parts = [
						theme.fg("dim", cwd),
						styledContext,
						theme.fg("dim", `$${getTotalCost(ctx).toFixed(3)}`),
					];

					const statuses = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([, text]) => sanitizeStatusText(text))
						.filter(Boolean);
					parts.push(...statuses);

					const separator = theme.fg("dim", " | ");
					return [truncateToWidth(parts.join(separator), width, theme.fg("dim", "…"))];
				},
			};
		});
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
	});
}
