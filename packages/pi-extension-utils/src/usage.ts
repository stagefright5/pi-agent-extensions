import type { ExtensionAPI, ToolResultEventResult } from "@earendil-works/pi-coding-agent";
export type NestedUsage = NonNullable<ToolResultEventResult["usage"]>;
export const EXTENSION_USAGE_TYPE = "extension-model-usage";
/** UI-owned requests have no tool result. Keep their billing durable and visible to the status bar. */
export function recordExtensionUsage(pi: ExtensionAPI, source: string, usage: NestedUsage | undefined): void {
	if (usage) pi.appendEntry(EXTENSION_USAGE_TYPE, { source, usage });
}

/**
 * Account for reported usage even when a UI request is cancelled. The owning session aborts its
 * requests, then drains before its runtime is revoked. Never append late usage to a new session.
 * Providers that ignore abort or never return usage remain best-effort, not a billing ledger.
 */
export function createUsageTracker(pi: ExtensionAPI, source: string) {
	let open = true;
	const pending = new Set<Promise<unknown>>();
	return {
		record(usage: NestedUsage | undefined): void {
			if (open) recordExtensionUsage(pi, source, usage);
		},
		track<T>(work: Promise<T>): Promise<T> {
			pending.add(work);
			const remove = () => {
				pending.delete(work);
			};
			void work.then(remove, remove);
			return work;
		},
		close(): void {
			open = false;
		},
		async drain(timeoutMs = 1000): Promise<void> {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.allSettled(pending),
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, timeoutMs);
					}),
				]);
			} finally {
				clearTimeout(timer);
				open = false;
			}
		},
	};
}
