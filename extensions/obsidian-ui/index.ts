import {
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { resolveRenderers, type NativeRendererIdentity } from "./tool-renderers.ts";

export default function obsidianUi(pi: ExtensionAPI): void {
	if (typeof pi.registerToolRenderer !== "function") {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.mode === "tui")
				ctx.ui.notify(
					"Obsidian UI tool styling requires pi 1.0.1+. The theme can still be selected separately.",
					"warning",
				);
		});
		return;
	}
	// Factories only obtain native renderer identities; no tools are registered or executed.
	const natives = new Map<string, NativeRendererIdentity>(
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
