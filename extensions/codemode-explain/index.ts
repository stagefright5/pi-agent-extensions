import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { codeKey, ENTRY_TYPE, parseModelRef, pickModel, summarize, SummaryStore, type ModelRef } from "./explain.ts";
import { explainRenderers, stopAnimations } from "./renderer.ts";

const TIMEOUT_MS = 30_000;

/** `"codemodeExplain": { "model": "provider/id" }` in ~/.pi/agent/settings.json. */
function configuredModel(): ModelRef | undefined {
	try {
		const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf-8"));
		return parseModelRef(settings?.codemodeExplain?.model);
	} catch {
		return undefined;
	}
}

export default function codemodeExplain(pi: ExtensionAPI): void {
	const store = new SummaryStore();
	let session = new AbortController();
	let warned = false;

	pi.registerToolRenderer((name, next) => {
		const native = next();
		return name === "codemode" && native?.renderCall && native.renderShell !== "self"
			? explainRenderers(native, store)
			: native;
	});

	pi.on("session_start", (_event, ctx) => {
		session.abort();
		session = new AbortController();
		store.clear();
		warned = false;
		// Summaries are keyed by script, not branch, so every stored one is reusable.
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
		if (event.toolName !== "codemode" || ctx.mode !== "tui") return;
		const code = (event.input as { code?: unknown }).code;
		if (typeof code !== "string" || !code.trim()) return;
		const key = codeKey(code);
		if (store.get(key)) return;
		const configured = configuredModel();
		const model = pickModel(ctx.model, ctx.modelRegistry.getAvailable(), configured);
		if (!model) {
			if (configured && !warned) {
				warned = true;
				ctx.ui.notify(`codemode-explain: ${configured.provider}/${configured.id} is not available`, "warning");
			}
			return;
		}
		store.set(key, { status: "pending" });
		const { signal } = session;
		// Never awaited: the script runs while its summary is written.
		summarize(ctx.modelRegistry, model, code, AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])).then(
			(summary) => {
				if (signal.aborted) return;
				store.set(key, { status: "done", text: summary });
				pi.appendEntry(ENTRY_TYPE, { key, summary, model: `${model.provider}/${model.id}` });
			},
			(error: unknown) => {
				if (signal.aborted) return store.delete(key);
				store.set(key, { status: "failed" });
				if (warned) return;
				warned = true;
				const reason = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`codemode-explain: ${model.provider}/${model.id} failed: ${reason}`, "warning");
			},
		);
	});
}
