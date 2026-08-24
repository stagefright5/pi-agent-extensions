import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

type UserBashResultHandler = (event: UserBashResultEvent) => void;
type RegisterUserBashResult = (event: "user_bash_result", handler: UserBashResultHandler) => void;

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

function onUserBashResult(pi: ExtensionAPI, handler: UserBashResultHandler): void {
	const register = pi.on as unknown as RegisterUserBashResult;
	register("user_bash_result", handler);
}

export default function bangDontGhostExtension(pi: ExtensionAPI): void {
	onUserBashResult(pi, (event) => {
		if (event.excludeFromContext || event.result.cancelled) return;

		const { message, options } = createEmptyFollowUpRequest();
		pi.sendMessage(message, options);
	});
}
