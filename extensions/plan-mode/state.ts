import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { getMessageText } from "./planning.ts";

export const STATE_TYPE = "plan-mode-interactive";
const schema = Type.Object({
	version: Type.Optional(Type.Literal(2)),
	reset: Type.Optional(Type.Boolean()),
	active: Type.Optional(Type.Boolean()),
	planDir: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	planTitle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	iterations: Type.Optional(Type.Array(Type.String())),
	qaMessages: Type.Optional(
		Type.Array(
			Type.Object({
				role: Type.Union([Type.Literal("user"), Type.Literal("assistant")]),
				content: Type.String(),
			}),
		),
	),
	revisionPending: Type.Optional(Type.Boolean()),
});
export type PlanState = {
	active: boolean;
	planDir: string | null;
	planTitle: string | null;
	iterations: string[];
	qaMessages: Array<{ role: "user" | "assistant"; content: string }>;
	revisionPending: boolean;
};
const empty = (): PlanState => ({
	active: false,
	planDir: null,
	planTitle: null,
	iterations: [],
	qaMessages: [],
	revisionPending: false,
});

/** Replay only the active branch. Legacy snapshots remain authoritative at their position. */
export function restorePlanState(branch: readonly SessionEntry[]): PlanState {
	let state = empty();
	let legacySnapshots = true;
	const calls = new Map<string, { title: string; plan: string }>();
	for (const entry of branch) {
		if (entry.type === "custom" && entry.customType === STATE_TYPE && Check(schema, entry.data)) {
			const data = entry.data;
			legacySnapshots = data.version !== 2;
			if (data.reset) {
				state = empty();
				calls.clear();
			}
			state.active = data.active ?? state.active;
			state.planDir = data.planDir === undefined ? state.planDir : data.planDir;
			state.planTitle = data.planTitle === undefined ? state.planTitle : data.planTitle;
			state.revisionPending = data.revisionPending ?? state.revisionPending;
			if (data.iterations) state.iterations = [...data.iterations];
			if (data.qaMessages) state.qaMessages = data.qaMessages.map((message) => ({ ...message }));
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (
					part.type === "toolCall" &&
					part.name === "plan_output" &&
					typeof part.arguments.plan === "string" &&
					typeof part.arguments.title === "string"
				)
					calls.set(part.id, { plan: part.arguments.plan, title: part.arguments.title });
			}
		}
		if (message.role === "toolResult" && message.toolName === "plan_output" && !message.isError) {
			const data = message.details as
				| { presented?: unknown; iteration?: unknown; planDir?: unknown; plan?: unknown; title?: unknown }
				| undefined;
			const call = calls.get(message.toolCallId);
			const plan = typeof data?.plan === "string" ? data.plan : call?.plan;
			if (
				data?.presented !== true ||
				typeof data.iteration !== "number" ||
				!Number.isSafeInteger(data.iteration) ||
				data.iteration < 1 ||
				typeof data.planDir !== "string" ||
				plan === undefined
			)
				continue;
			// A legacy snapshot may already contain this result. Do not append it twice.
			if (data.iteration <= state.iterations.length + 1) state.iterations[data.iteration - 1] = plan;
			state.planDir = data.planDir;
			state.planTitle = typeof data.title === "string" ? data.title : (call?.title ?? state.planTitle);
			state.revisionPending = false;
			continue;
		}
		// Old message_end hooks wrote the full Q&A snapshot BEFORE the message itself.
		// Replay messages only after an explicit v2 boundary, or the last old message doubles.
		if (legacySnapshots || !state.active || (message.role !== "assistant" && message.role !== "user")) continue;
		if (
			message.role === "assistant" &&
			message.content.some((part) => part.type === "toolCall" && part.name === "plan_output")
		)
			continue;
		const content = getMessageText(message.content);
		if (content.trim()) state.qaMessages.push({ role: message.role, content });
	}
	return state;
}
