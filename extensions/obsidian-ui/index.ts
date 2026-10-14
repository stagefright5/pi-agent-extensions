import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { resolveRenderers } from "./tool-renderers.ts";

export default function obsidianUi(pi: ExtensionAPI): void {
	if (typeof pi.registerToolRenderer !== "function") {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.mode === "tui")
				ctx.ui.notify(
					"Obsidian UI tool styling requires pi 1.2+. The theme can still be selected separately.",
					"warning",
				);
		});
		return;
	}
	// Factories only obtain native renderer identities; no tools are registered or executed.
	const natives = new Map<string, ToolRenderers>(
		[
			createReadToolDefinition(process.cwd()),
			createWriteToolDefinition(process.cwd()),
			createGrepToolDefinition(process.cwd()),
			createFindToolDefinition(process.cwd()),
			createLsToolDefinition(process.cwd()),
		].map((tool) => [tool.name, tool]),
	);
	pi.registerToolRenderer((name, next) => resolveRenderers(name, next(), natives));
}
