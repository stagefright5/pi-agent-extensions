import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const BANG_DONT_GHOST_MESSAGE_TYPE = "bang-dont-ghost";

export interface BashCompletion {
	command: string;
	entryId: string;
}

export function createEmptyFollowUpRequest() {
	return {
		message: {
			customType: BANG_DONT_GHOST_MESSAGE_TYPE,
			content: [],
			display: false,
		},
		options: {
			triggerTurn: true,
			deliverAs: "followUp" as const,
		},
	};
}

export class BashCompletionTracker {
	private nextEntryIndex = 0;
	private pendingCommands: string[] = [];

	reset(entries: readonly SessionEntry[]): void {
		this.nextEntryIndex = entries.length;
		this.pendingCommands = [];
	}

	expect(command: string): void {
		this.pendingCommands.push(command);
	}

	hasPending(): boolean {
		return this.pendingCommands.length > 0;
	}

	scan(entries: readonly SessionEntry[]): BashCompletion[] {
		if (entries.length < this.nextEntryIndex) {
			this.reset(entries);
			return [];
		}

		const completions: BashCompletion[] = [];

		for (let index = this.nextEntryIndex; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== "message" || entry.message.role !== "bashExecution") continue;
			if (entry.message.excludeFromContext) continue;

			const pendingIndex = this.pendingCommands.indexOf(entry.message.command);
			if (pendingIndex === -1) continue;

			this.pendingCommands.splice(pendingIndex, 1);
			if (entry.message.cancelled) continue;

			completions.push({ command: entry.message.command, entryId: entry.id });
		}

		this.nextEntryIndex = entries.length;
		return completions;
	}
}
