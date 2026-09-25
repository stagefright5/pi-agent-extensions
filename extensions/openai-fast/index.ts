import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

// OpenAI calls its Fast mode the "priority" service tier. It costs more.
const PROVIDERS = ["openai", "openai-codex"];

// Saved next to pi's own settings, like defaultModel.
const SETTINGS = join(getAgentDir(), "settings.json");
const KEY = "openaiFast";

function loadSaved(): boolean {
	try {
		return JSON.parse(readFileSync(SETTINGS, "utf-8"))[KEY] === true;
	} catch {
		return false;
	}
}

function save(on: boolean) {
	// No try/catch: never overwrite a settings file we could not read.
	const settings = JSON.parse(readFileSync(SETTINGS, "utf-8"));
	settings[KEY] = on;
	writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
}

export default function (pi: ExtensionAPI) {
	let on = false;

	const isOpenAI = (model: ExtensionContext["model"]) => PROVIDERS.includes(model?.provider ?? "");
	const show = (ctx: ExtensionContext, model = ctx.model) =>
		ctx.ui.setStatus("fast", on && isOpenAI(model) ? "fast" : undefined);

	pi.registerFlag("fast", { description: "Turn on OpenAI Fast mode for this run", type: "boolean", default: false });

	pi.on("session_start", (_event, ctx) => {
		on = pi.getFlag("fast") === true || loadSaved();
		show(ctx);
	});

	pi.on("model_select", (event, ctx) => show(ctx, event.model));

	pi.registerCommand("fast", {
		description: "Toggle OpenAI Fast mode (priority service tier) and save it",
		handler: async (_args, ctx) => {
			if (!on && !isOpenAI(ctx.model)) {
				ctx.ui.notify("Fast mode only works with OpenAI models", "warning");
				return;
			}
			save(!on);
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
