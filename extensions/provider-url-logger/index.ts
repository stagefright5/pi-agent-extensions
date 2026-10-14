import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", async (_event, ctx) => {
		if (!ctx.model) return;

		const agentDir = getAgentDir();
		await mkdir(agentDir, { recursive: true });
		await appendFile(
			join(agentDir, "provider-urls.log"),
			`${new Date().toISOString()} ${ctx.model.provider}/${ctx.model.id} ${ctx.model.baseUrl}\n`,
		);
	});
}
