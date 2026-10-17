import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Detached work must neither use a retired context nor reject because reporting an error failed. */
export function notifyIfActive(
	signal: AbortSignal,
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error" = "warning",
): void {
	if (signal.aborted) return;
	try {
		if (ctx.hasUI || ctx.mode === "tui") ctx.ui.notify(message, type);
	} catch {
		// The runtime may have revoked even the context getters. Notifications are best-effort.
	}
}
