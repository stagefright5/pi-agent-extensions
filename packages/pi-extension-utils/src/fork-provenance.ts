/**
 * Session-fork provenance contract.
 *
 * A side-agent child transcript is a copy of its parent's selected branch followed by one custom
 * entry of this type. Extensions that keep writable, process-external state (for example a plan
 * repository path) can treat state recorded before the latest marker as inherited from another
 * session and allocate their own before writing. The entry never reaches model context.
 */
export const SIDE_AGENT_FORK_TYPE = "side-agent-fork";

export type SideAgentForkData = {
	version: 1;
	parentSessionId: string;
	parentSessionFile: string;
	/** Parent leaf when the fork was captured; may be newer than the boundary while the parent was busy. */
	parentLeafId: string | null;
	/** Last copied parent entry. */
	boundaryId: string;
	childSessionId: string;
	createdAt: string;
	title: string;
};

type EntryLike = { type: string; customType?: string; data?: unknown };

export function isSideAgentForkEntry(entry: EntryLike): entry is EntryLike & { data: SideAgentForkData } {
	if (entry.type !== "custom" || entry.customType !== SIDE_AGENT_FORK_TYPE) return false;
	const data = entry.data as Partial<SideAgentForkData> | undefined;
	return (
		data?.version === 1 &&
		typeof data.childSessionId === "string" &&
		typeof data.parentSessionId === "string" &&
		typeof data.boundaryId === "string"
	);
}
