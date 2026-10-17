import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ChatModel = NonNullable<ExtensionContext["model"]>;
type Registry = Pick<ExtensionContext["modelRegistry"], "streamSimple">;
export type ModelRef = { provider: string; id: string };
export type Summary = { status: "pending" } | { status: "done"; text: string } | { status: "failed" };

export const ENTRY_TYPE = "codemode-explain";
const MAX_CODE_CHARS = 12_000;
const SMALL_MODEL = /haiku|mini|flash|lite|nano|small/i;

export const SYSTEM_PROMPT = `You label JavaScript scripts that an AI coding agent runs through its "codemode" tool.
In a script, \`tools.<name>(args)\` calls an agent tool (read, bash, edit, write, grep, MCP tools, ...),
\`models\` runs classifier or image models, and \`text()\`, \`console.log()\` and \`return\` produce output.
Reply with one plain-text line of at most 12 words saying what the script does, starting with a verb.
Example: Read three package.json files and compare their versions
No code, quotes, markdown, preamble, or trailing period.`;

/** Stable key for a script, so summaries survive reloads and repeat calls. */
export function codeKey(code: string): string {
	return createHash("sha256").update(code).digest("hex").slice(0, 16);
}

export function parseModelRef(value: unknown): ModelRef | undefined {
	if (typeof value !== "string") return undefined;
	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return undefined;
	return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

/**
 * The configured model when set, otherwise the cheapest available text model of the session's
 * provider (preferring small-model names on equal price), otherwise the session model.
 */
export function pickModel(
	current: ChatModel | undefined,
	available: readonly ChatModel[],
	configured?: ModelRef,
): ChatModel | undefined {
	if (configured) return available.find((m) => m.provider === configured.provider && m.id === configured.id);
	if (!current) return undefined;
	const price = (m: ChatModel) => (m.cost?.input ?? 0) + (m.cost?.output ?? 0);
	const candidates = available
		.filter((m) => m.provider === current.provider && (m.type ?? "chat") === "chat" && m.input.includes("text"))
		.sort((a, b) => price(a) - price(b) || Number(SMALL_MODEL.test(b.id)) - Number(SMALL_MODEL.test(a.id)));
	return candidates[0] ?? current;
}

/** One line, whatever decoration the model added. Never shortened: rows wrap it. */
export function cleanSummary(raw: string): string {
	const line =
		stripVTControlCharacters(raw)
			.replace(/\p{Cc}+/gu, "\n")
			.split("\n")
			.map((part) => part.trim())
			.find(Boolean) ?? "";
	const text = line
		.replace(/^(?:[-*•>#]+\s*)+/, "")
		.replace(/^(?:summary|label|answer)\s*:\s*/i, "")
		.replace(/^["'`*_]+|["'`*_]+$/g, "")
		.replace(/\s+/g, " ")
		.replace(/[.\s]+$/, "")
		.trim();
	return text;
}

export async function summarize(registry: Registry, model: ChatModel, code: string, signal: AbortSignal) {
	const clipped =
		code.length > MAX_CODE_CHARS
			? `${code.slice(0, MAX_CODE_CHARS)}\n// ... ${code.length - MAX_CODE_CHARS} more characters`
			: code;
	const message = await registry
		.streamSimple(
			model,
			{
				systemPrompt: SYSTEM_PROMPT,
				messages: [{ role: "user", content: [{ type: "text", text: clipped }], timestamp: Date.now() }],
			},
			{ maxTokens: 300, signal },
		)
		.result();
	if (message.stopReason === "error" || message.stopReason === "aborted")
		throw new Error(message.errorMessage ?? message.stopReason);
	const text = cleanSummary(message.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"));
	if (!text) throw new Error("empty summary");
	return text;
}

/** In-memory summaries by code key; rows waiting on a pending summary redraw when it settles. */
export class SummaryStore {
	private readonly summaries = new Map<string, Summary>();
	private readonly waiting = new Map<string, Set<() => void>>();

	get(key: string): Summary | undefined {
		return this.summaries.get(key);
	}
	set(key: string, summary: Summary): void {
		this.summaries.set(key, summary);
		if (summary.status === "pending") return;
		const listeners = this.waiting.get(key);
		this.waiting.delete(key);
		for (const listener of listeners ?? []) listener();
	}
	delete(key: string): void {
		this.summaries.delete(key);
		this.waiting.delete(key);
	}
	wait(key: string, listener: () => void): void {
		let listeners = this.waiting.get(key);
		if (!listeners) this.waiting.set(key, (listeners = new Set()));
		listeners.add(listener);
	}
	clear(): void {
		this.summaries.clear();
		this.waiting.clear();
	}
}
