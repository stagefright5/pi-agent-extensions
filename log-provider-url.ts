import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const logFile = join(homedir(), ".pi", "agent", "provider-urls.log");

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (_event, ctx) => {
		if (!ctx.model) return;

		appendFileSync(
			logFile,
			`${new Date().toISOString()} ${ctx.model.provider}/${ctx.model.id} ${ctx.model.baseUrl}\n`,
		);
	});
}
