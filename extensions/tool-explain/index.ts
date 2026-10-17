import { createEditToolDefinition, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createUsageTracker, notifyIfActive } from "@stagefright5/pi-extension-utils";
import { toolKey, ENTRY_TYPE, pickModel, summarize, SummaryStore } from "./explain.ts";
import { enabled, loadSettings, registerPicker, type ExplainSettings } from "./settings.ts";
import { explainRenderers, stopAnimations } from "./renderer.ts";

const TIMEOUT_MS = 30_000;

export default function toolExplain(pi: ExtensionAPI): void {
	const store = new SummaryStore();
	let session = new AbortController();
	let usage = createUsageTracker(pi, "tool-explain");
	let warned = false;
	// Action APIs (including getSettings) are unavailable during extension loading.
	let settings: ExplainSettings = { tools: "all", excludeTools: [] };
	registerPicker(pi);
	const nativeEdit = createEditToolDefinition(process.cwd());

	pi.registerToolRenderer((name, next) => {
		const native = next();
		// The native edit call component owns the diff; keep updating it while collapsed
		// and reveal it on expansion. Leave unknown self-owned renderers untouched.
		const isNativeEdit =
			name === "edit" &&
			native?.renderCall === nativeEdit.renderCall &&
			native?.renderResult === nativeEdit.renderResult;
		return enabled(settings, name) && (native?.renderShell !== "self" || isNativeEdit)
			? explainRenderers(native ?? {}, store, name)
			: native;
	});

	pi.on("session_start", (_event, ctx) => {
		session.abort();
		usage.close();
		usage = createUsageTracker(pi, "tool-explain");
		stopAnimations();
		session = new AbortController();
		store.clear();
		warned = false;
		try {
			settings = loadSettings(getAgentDir(), pi.getSettings());
		} catch (error) {
			settings = { tools: [], excludeTools: [] };
			if (ctx.mode === "tui") ctx.ui.notify(`tool-explain: ${String(error)}; explanations disabled`, "warning");
		}
		// Keys depend on the tool and arguments, so summaries can be reused across branches.
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
			const data = entry.data as { key?: unknown; summary?: unknown; callIds?: unknown } | undefined;
			if (typeof data?.key !== "string" || typeof data.summary !== "string") continue;
			store.set(data.key, { status: "done", text: data.summary });
			if (Array.isArray(data.callIds))
				for (const id of data.callIds) if (typeof id === "string") store.bindCall(id, data.key);
		}
	});

	pi.on("session_shutdown", async () => {
		session.abort();
		stopAnimations();
		await usage.drain();
	});

	pi.on("tool_call", (event, ctx) => {
		if (ctx.mode !== "tui" || event.parentToolCallId || !enabled(settings, event.toolName)) return;
		const isCode = event.toolName === "codemode";
		const code = (event.input as { code?: unknown }).code;
		if (isCode && (typeof code !== "string" || !code.trim())) return;
		const key = toolKey(event.toolName, event.input);
		const bound = store.bindCall(event.toolCallId, key);
		const cached = store.get(key);
		if (cached) {
			if (bound && cached.status === "done")
				pi.appendEntry(ENTRY_TYPE, { key, summary: cached.text, callIds: [event.toolCallId] });
			return;
		}
		const configured = settings.model;
		if (session.signal.aborted || (!configured && !ctx.model)) return;
		// Arguments come before the description, so clipping a long input drops description text first.
		const input = JSON.stringify({
			tool: event.toolName,
			arguments: event.input,
			description: pi
				.getAllTools()
				.find((tool) => tool.name === event.toolName)
				?.description?.slice(0, 2000),
		});
		store.set(key, { status: "pending" });
		const { signal } = session;
		const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
		let modelName = configured ? `${configured.provider}/${configured.id}` : "summary model";
		// Model discovery/auth and generation both run off the tool-execution path.
		const accounting = usage;
		void accounting
			.track(
				(async () => {
					const available = await ctx.modelRegistry.getAvailableOfType(
						"chat",
						configured?.provider ?? ctx.model?.provider,
						{ signal: requestSignal },
					);
					signal.throwIfAborted();
					const model = pickModel(ctx.model, available, configured);
					if (!model) {
						if (configured) throw new Error("is not available");
						return;
					}
					modelName = `${model.provider}/${model.id}`;
					return summarize(ctx.modelRegistry, model, input, requestSignal, accounting.record);
				})(),
			)
			.then((summary) => {
				if (signal.aborted) return;
				if (summary === undefined) {
					store.delete(key);
					return;
				}
				store.set(key, { status: "done", text: summary });
				const callIds = store.callIds(key);
				pi.appendEntry(ENTRY_TYPE, {
					key,
					summary,
					model: modelName,
					...(callIds.length ? { callIds } : {}),
				});
			})
			.catch((error: unknown) => {
				if (signal.aborted) return;
				store.set(key, { status: "failed" });
				if (warned) return;
				warned = true;
				const reason = error instanceof Error ? error.message : String(error);
				notifyIfActive(
					signal,
					ctx,
					`tool-explain: ${modelName}${reason === "is not available" ? " " : " failed: "}${reason}`,
					"warning",
				);
			});
	});
}
