import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const BANG_DONT_GHOST_MESSAGE_TYPE = "bang-dont-ghost";

export interface UserBashResultEvent {
	type: "user_bash_result";
	command: string;
	excludeFromContext: boolean;
	result: {
		output: string;
		exitCode: number | undefined;
		cancelled: boolean;
		truncated: boolean;
		fullOutputPath?: string;
	};
}

// This is the explicit contract added by our version-locked 1.2.0 runtime patch,
// not an assertion that stock pi emits this event. Keep it typed without casting pi.on.
declare module "@earendil-works/pi-coding-agent" {
	interface ExtensionAPI {
		on(
			event: "user_bash_result",
			handler: (event: UserBashResultEvent, ctx: ExtensionContext) => void | Promise<void>,
		): () => void;
	}
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

export default function bangDontGhostExtension(pi: ExtensionAPI): void {
	pi.on("user_bash_result", (event) => {
		if (event.excludeFromContext || event.result.cancelled) return;

		const { message, options } = createEmptyFollowUpRequest();
		pi.sendMessage(message, options);
	});
}
