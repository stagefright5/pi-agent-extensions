import { EXTENSION_USAGE_TYPE } from "@stagefright5/pi-extension-utils";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

/** Match pi's cumulative billing: all branches, including non-assistant usage. */
export function totalSessionCost(entries: readonly SessionEntry[]): number {
	let total = 0;
	for (const entry of entries) {
		if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
			total += entry.usage?.cost.total ?? 0;
		} else if (entry.type === "custom" && entry.customType === EXTENSION_USAGE_TYPE) {
			const cost = (entry.data as { usage?: { cost?: { total?: unknown } } })?.usage?.cost?.total;
			if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) total += cost;
		} else if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "assistant" || message.role === "toolResult") {
				total += message.usage?.cost.total ?? 0;
			}
		}
	}
	return total;
}

/** Every append moves the leaf; don't copy/scan the transcript on each TUI frame. */
export function createSessionCostReader(): (
	session: Pick<ExtensionContext["sessionManager"], "getSessionId" | "getLeafId" | "getEntries">,
) => number {
	let cached: { sessionId: string; leafId: string | null; cost: number } | undefined;
	return (session) => {
		const sessionId = session.getSessionId();
		const leafId = session.getLeafId();
		if (!cached || cached.sessionId !== sessionId || cached.leafId !== leafId) {
			cached = { sessionId, leafId, cost: totalSessionCost(session.getEntries()) };
		}
		return cached.cost;
	};
}
