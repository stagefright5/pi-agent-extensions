import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { toolKey, ENTRY_TYPE, pickModel, summarize, SummaryStore, TOOL_SYSTEM_PROMPT } from "./explain.ts";
import { enabled, loadSettings, registerPicker, type ExplainSettings } from "./settings.ts";
import { explainRenderers, stopAnimations } from "./renderer.ts";

const TIMEOUT_MS = 30_000;

export default function toolExplain(pi: ExtensionAPI): void {
	const store = new SummaryStore();
	let session = new AbortController();
	let warned = false;
	let settingsError: unknown;
	let settings: ExplainSettings = { tools: [], excludeTools: [] };
	try {
		settings = loadSettings();
	} catch (error) {
		settingsError = error;
	}
	registerPicker(pi);

	pi.registerToolRenderer((name, next) => {
		const native = next();
		return enabled(settings, name) ? explainRenderers(native ?? {}, store, name) : native;
	});

	pi.on("session_start", (_event, ctx) => {
		session.abort();
		stopAnimations();
		session = new AbortController();
		store.clear();
		warned = false;
		if (settingsError && ctx.mode === "tui")
			ctx.ui.notify(`tool-explain: ${String(settingsError)}; explanations disabled`, "warning");
		// Keys depend on the tool and arguments, so summaries can be reused across branches.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as { key?: unknown; summary?: unknown } | undefined;
			if (typeof data?.key === "string" && typeof data.summary === "string")
				store.set(data.key, { status: "done", text: data.summary });
		}
	});

	pi.on("session_shutdown", () => {
		session.abort();
		stopAnimations();
	});

	pi.on("tool_call", (event, ctx) => {
		if (ctx.mode !== "tui" || event.parentToolCallId || !enabled(settings, event.toolName)) return;
		const isCode = event.toolName === "codemode";
		const code = (event.input as { code?: unknown }).code;
		if (isCode && (typeof code !== "string" || !code.trim())) return;
		const key = toolKey(event.toolName, event.input);
		if (store.get(key)) return;
		let configured = settings.model;
		try {
			configured = loadSettings().model;
		} catch {
			// Use the model setting loaded at startup if the file cannot be read.
		}
		const input = isCode
			? (code as string)
			: JSON.stringify({
					tool: event.toolName,
					description: pi
						.getAllTools()
						.find((tool) => tool.name === event.toolName)
						?.description?.slice(0, 2000),
					arguments: event.input,
				});
		const model = pickModel(ctx.model, ctx.modelRegistry.getAvailable(), configured);
		if (!model) {
			if (configured && !warned) {
				warned = true;
				ctx.ui.notify(`tool-explain: ${configured.provider}/${configured.id} is not available`, "warning");
			}
			return;
		}
		store.set(key, { status: "pending" });
		const { signal } = session;
		// Do not delay tool execution for the summary request.
		summarize(
			ctx.modelRegistry,
			model,
			input,
			AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
			isCode ? undefined : TOOL_SYSTEM_PROMPT,
		).then(
			(summary) => {
				if (signal.aborted) return;
				store.set(key, { status: "done", text: summary });
				pi.appendEntry(ENTRY_TYPE, { key, summary, model: `${model.provider}/${model.id}` });
			},
			(error: unknown) => {
				if (signal.aborted) return;
				store.set(key, { status: "failed" });
				if (warned) return;
				warned = true;
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`tool-explain: ${model.provider}/${model.id} failed: ${reason}`, "warning");
			},
		);
	});
}
