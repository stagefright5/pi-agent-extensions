import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildAskPrompt } from "./ask-prompt.ts";

export default function askExtension(pi: ExtensionAPI): void {
	pi.registerCommand("ask", {
		description: "Ask me before deciding — use whatever interactive question tool this harness provides",
		handler: (args, ctx) => {
			const prompt = buildAskPrompt(args);
			if (ctx.isIdle()) {
				pi.sendUserMessage(prompt);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "steer" });
			}
		},
	});
}
