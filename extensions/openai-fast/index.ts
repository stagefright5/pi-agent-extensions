import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readJsonFile, writeJsonFile, registerModelStatus, getSetting } from "@stagefright5/pi-extension-utils";

const PROVIDERS = ["openai", "openai-codex"];
const settingsPath = () => join(getAgentDir(), "openai-fast.json");

export function loadSaved(legacy: unknown): boolean {
	const saved = readJsonFile(settingsPath());
	if (saved === undefined) return legacy === true;
	if (!saved || typeof saved !== "object" || !("enabled" in saved) || typeof saved.enabled !== "boolean")
		throw new Error("openai-fast.json must contain a boolean enabled field");
	return saved.enabled;
}

export default function (pi: ExtensionAPI) {
	let on = false;
	let detachStatus: (() => void) | undefined;
	const isOpenAI = (model: ExtensionContext["model"]) => PROVIDERS.includes(model?.provider ?? "");
	const show = (ctx: ExtensionContext, model = ctx.model) =>
		ctx.ui.setStatus("fast", on && isOpenAI(model) ? "⚡︎" : undefined);

	pi.registerFlag("fast", { description: "Turn on OpenAI Fast mode for this run", type: "boolean", default: false });
	pi.on("session_start", (_event, ctx) => {
		detachStatus?.();
		detachStatus = registerModelStatus("fast");
		try {
			on = pi.getFlag("fast") === true || loadSaved(getSetting(pi.getSettings(), "openaiFast"));
		} catch (error) {
			on = false;
			ctx.ui.notify(String(error), "warning");
		}
		show(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		detachStatus?.();
		detachStatus = undefined;
		ctx.ui.setStatus("fast", undefined);
	});
	pi.on("model_select", (event, ctx) => show(ctx, event.model));
	pi.registerCommand("fast", {
		description: "Toggle OpenAI Fast mode (priority service tier) and save it",
		handler: async (_args, ctx) => {
			if (!on && !isOpenAI(ctx.model)) {
				ctx.ui.notify("Fast mode only works with OpenAI models", "warning");
				return;
			}
			// Do not silently overwrite malformed saved configuration.
			loadSaved(getSetting(pi.getSettings(), "openaiFast"));
			writeJsonFile(settingsPath(), { enabled: !on });
			on = !on;
			show(ctx);
			ctx.ui.notify(`Fast mode ${on ? "on" : "off"}`, "info");
		},
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (!on || !isOpenAI(ctx.model)) return;
		return { ...(event.payload as object), service_tier: "priority" };
	});
}
