import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BashCompletionTracker, createEmptyFollowUpRequest } from "./bang-follow-up.ts";

const POLL_INTERVAL_MS = 50;

export default function bangDontGhostExtension(pi: ExtensionAPI): void {
	const tracker = new BashCompletionTracker();
	let active = false;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;

	const stopPolling = (): void => {
		if (pollTimer !== undefined) clearTimeout(pollTimer);
		pollTimer = undefined;
	};

	const triggerCompletions = (ctx: ExtensionContext): void => {
		const completions = tracker.scan(ctx.sessionManager.getEntries());
		for (const _completion of completions) {
			const { message, options } = createEmptyFollowUpRequest();
			pi.sendMessage(message, options);
		}
	};

	const poll = (ctx: ExtensionContext): void => {
		pollTimer = undefined;
		if (!active) return;

		triggerCompletions(ctx);
		if (tracker.hasPending()) {
			pollTimer = setTimeout(() => poll(ctx), POLL_INTERVAL_MS);
		}
	};

	const startPolling = (ctx: ExtensionContext): void => {
		if (pollTimer === undefined) {
			pollTimer = setTimeout(() => poll(ctx), 0);
		}
	};

	pi.on("session_start", (_event, ctx) => {
		active = true;
		stopPolling();
		tracker.reset(ctx.sessionManager.getEntries());
	});

	pi.on("user_bash", (event, ctx) => {
		triggerCompletions(ctx);
		if (event.excludeFromContext) return;

		tracker.expect(event.command);
		startPolling(ctx);
	});

	pi.on("session_shutdown", () => {
		active = false;
		stopPolling();
	});
}
