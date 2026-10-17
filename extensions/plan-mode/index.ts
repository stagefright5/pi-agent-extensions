/** Evidence-guided planning with session-scoped, cancellable review UI. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, stripTerminalSequences, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { join } from "node:path";
import { homedir } from "node:os";
import { PlanRepository, SerialTaskQueue } from "./plan-store.ts";
import {
	createPlanMessageComponent,
	requestRevision,
	showDocument,
	withLoader,
	type DocumentAction,
} from "./plan-ui.ts";
import {
	assistantTextLooksLikePlan,
	buildPlanModeSystemPrompt,
	getMessageText,
	isPlanRevisionIntent,
} from "./planning.ts";

const STATE_TYPE = "plan-mode-interactive";
const PLAN_RENDER_MESSAGE_TYPE = "plan-mode-rendered-plan";
const REMINDER_TYPE = "plan-mode-revision-reminder";
const stateSchema = Type.Object({
	active: Type.Optional(Type.Boolean()),
	planDir: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	iterations: Type.Optional(Type.Array(Type.String())),
	planTitle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
const renderDetailsSchema = Type.Object({
	plan: Type.Optional(Type.String()),
	title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	iteration: Type.Optional(Type.Number()),
	planPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
const outputDetailsSchema = Type.Object({
	presented: Type.Literal(true),
	iteration: Type.Number(),
	planDir: Type.String(),
});

/** "writing plan · 142 lines · 4.1k chars · Validation" from a partially streamed plan. */
export function planProgress(plan: unknown): string {
	const text = typeof plan === "string" ? plan : "";
	if (!text) return "writing plan…";
	const lines = text.split("\n").length;
	const chars = text.length >= 1000 ? `${(text.length / 1000).toFixed(1)}k` : String(text.length);
	const section = [...text.matchAll(/^#{1,6}\s+(.+)$/gmu)].at(-1)?.[1]?.trim();
	return `writing plan · ${lines} ${lines === 1 ? "line" : "lines"} · ${chars} chars${section ? ` · ${section}` : ""}`;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let active = false;
	let planDir: string | null = null;
	let iterations: string[] = [];
	let planTitle: string | null = null;
	let qaMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
	let isAgentWorking = false;
	let lastUserInputText = "";
	let lastUserInputPlanIteration = -1;
	let revisionPending = false;
	let revisionReminder: string | undefined;
	let reminderRequested = false;
	let pendingReview = false;
	let reviewToken: symbol | undefined;
	let scope = new AbortController();
	const saves = new SerialTaskQueue();
	const repository = new PlanRepository((...args) => pi.exec(...args), join(homedir(), ".pi", "plans"));

	function requireTui(ctx: ExtensionContext): boolean {
		if (ctx.mode === "tui") return true;
		if (ctx.hasUI) ctx.ui.notify("Plan review requires TUI interactive mode.", "warning");
		return false;
	}

	function resetInteractions(): void {
		scope.abort();
		scope = new AbortController();
		reviewToken = undefined;
		pendingReview = false;
		isAgentWorking = false;
		lastUserInputText = "";
		lastUserInputPlanIteration = -1;
		revisionReminder = undefined;
		reminderRequested = false;
	}

	function persistState(): void {
		// appendEntry retains its data object: snapshots must not share mutable arrays.
		pi.appendEntry(STATE_TYPE, {
			active,
			planDir,
			iterations: [...iterations],
			planTitle,
			qaMessages: qaMessages.map((message) => ({ ...message })),
			revisionPending,
		});
	}

	function restoreState(ctx: ExtensionContext): void {
		resetInteractions();
		const entry = ctx.sessionManager
			.getBranch()
			.findLast((item) => item.type === "custom" && item.customType === STATE_TYPE);
		const data = entry?.type === "custom" && Check(stateSchema, entry.data) ? entry.data : undefined;
		active = ctx.mode === "tui" && (data?.active ?? false);
		planDir = data?.planDir ?? null;
		iterations = [...(data?.iterations ?? [])];
		planTitle = data?.planTitle ?? null;
		qaMessages = (data?.qaMessages ?? []).map((message) => ({ ...message }));
		revisionPending = data?.revisionPending ?? false;
	}

	function updateUI(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		const theme = ctx.ui.theme;
		ctx.ui.setWorkingVisible(!active);
		ctx.ui.setStatus(
			"plan-mode",
			active
				? theme.fg("warning", "▣ Planning") +
						(planTitle ? theme.fg("muted", ` ${planTitle.replace(/[\r\n\t]/g, " ")}`) : "") +
						theme.fg(
							"dim",
							` · ${iterations.length} iteration${iterations.length === 1 ? "" : "s"}${isAgentWorking ? " · working" : ""}`,
						)
				: undefined,
		);
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		if (!requireTui(ctx)) return;
		resetInteractions();
		active = true;
		planDir = null;
		iterations = [];
		planTitle = null;
		qaMessages = [];
		revisionPending = false;
		persistState();
		updateUI(ctx);
		ctx.ui.notify("▣ Plan mode activated. Gather material evidence before presenting a plan.", "info");
	}

	function exitPlanMode(ctx: ExtensionContext, approved = false): void {
		resetInteractions();
		active = false;
		revisionPending = false;
		persistState();
		updateUI(ctx);
		ctx.ui.notify(approved ? "✓ Plan approved. Plan mode deactivated." : "Plan mode deactivated.", "info");
	}

	function planPath(): string | null {
		if (!planDir) return null;
		const absolute = join(planDir, "plan.md");
		const home = homedir();
		return absolute.startsWith(`${home}/`) ? `~/${absolute.slice(home.length + 1)}` : absolute;
	}

	pi.registerMessageRenderer(PLAN_RENDER_MESSAGE_TYPE, (message, _options, theme) => {
		const details = Check(renderDetailsSchema, message.details) ? message.details : undefined;
		return createPlanMessageComponent(
			details?.plan ?? getMessageText(message.content),
			details?.title ?? null,
			details?.iteration ?? 0,
			details?.planPath ?? null,
			theme,
		);
	});

	function renderPlanInChat(plan: string, iteration: number): void {
		pi.sendMessage({
			customType: PLAN_RENDER_MESSAGE_TYPE,
			content: `Plan iteration ${iteration} rendered in chat for review.`,
			display: true,
			details: { plan, title: planTitle, iteration, planPath: planPath() },
		});
	}

	function sendFollowUp(ctx: ExtensionContext, content: string): void {
		pi.sendUserMessage(content, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
	}

	async function showDiff(ctx: ExtensionContext, signal = scope.signal): Promise<void> {
		if (!requireTui(ctx) || signal.aborted) return;
		if (!planDir || iterations.length < 2) {
			ctx.ui.notify("Need at least 2 iterations to show a diff.", "warning");
			return;
		}
		const iteration = iterations.length;
		const diff = await repository.diff(iterations[iteration - 2], iterations[iteration - 1], signal);
		if (signal.aborted) return;
		if (!diff.trim()) {
			ctx.ui.notify("No changes between the last two iterations.", "info");
			return;
		}
		await showDocument(
			ctx,
			{
				kind: "Plan diff",
				title: planTitle ?? "",
				meta: `iteration ${iteration - 1} → ${iteration}`,
				subtitle: planPath() ?? "",
				content: diff,
				format: "diff",
			},
			signal,
		);
	}

	async function showSummary(ctx: ExtensionContext, allChanges: boolean, signal = scope.signal): Promise<void> {
		if (!requireTui(ctx) || signal.aborted) return;
		if (iterations.length < 2) {
			ctx.ui.notify("Need at least 2 iterations to generate a summary.", "warning");
			return;
		}
		const model = ctx.model;
		if (!model) {
			ctx.ui.notify("No model available for summary generation.", "error");
			return;
		}
		const versions = [...iterations];
		const title = allChanges
			? "Summary of all plan changes"
			: `Changes · iteration ${versions.length - 1} → ${versions.length}`;
		const prompt = allChanges
			? `Summarize ALL changes across these ${versions.length} plan iterations. What evolved, was added, removed, or restructured? Be concise and use markdown.\n\n${versions.map((plan, i) => `### Version ${i + 1}\n${plan}`).join("\n\n---\n\n")}`
			: `Summarize the changes between these two plan versions. What was added, removed, or modified? Be concise and use markdown.\n\n### Previous Version\n${versions.at(-2)}\n\n### Current Version\n${versions.at(-1)}`;
		const summary = await withLoader(ctx, `Generating ${title.toLowerCase()}…`, signal, async (requestSignal) => {
			const response = await ctx.modelRegistry.complete(
				model,
				{
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{ signal: requestSignal },
			);
			requestSignal.throwIfAborted();
			if (response.stopReason === "error" || response.stopReason === "aborted")
				throw new Error(response.errorMessage || response.stopReason);
			return getMessageText(response.content) || "(empty summary)";
		});
		if (summary !== undefined && !signal.aborted)
			await showDocument(
				ctx,
				{
					kind: "Plan summary",
					title: planTitle ?? "",
					meta: allChanges
						? `all ${versions.length} iterations`
						: `iteration ${versions.length - 1} → ${versions.length}`,
					subtitle: planPath() ?? "",
					content: summary,
				},
				signal,
			);
	}

	async function showQA(ctx: ExtensionContext, signal = scope.signal): Promise<void> {
		if (!requireTui(ctx) || signal.aborted) return;
		if (!qaMessages.length) {
			ctx.ui.notify("No Q&A history available.", "info");
			return;
		}
		await showDocument(
			ctx,
			{
				kind: "Q&A history",
				title: planTitle ?? "",
				meta: `${qaMessages.length} ${qaMessages.length === 1 ? "message" : "messages"}`,
				subtitle: planPath() ?? "",
				content: qaMessages
					.map((message) => `### ${message.role === "assistant" ? "Agent" : "You"}\n\n${message.content}`)
					.join("\n\n---\n\n"),
			},
			signal,
		);
	}

	async function openPlanReview(ctx: ExtensionContext): Promise<void> {
		if (!requireTui(ctx) || !iterations.length || scope.signal.aborted) return;
		if (reviewToken) {
			pendingReview = true;
			return;
		}
		const token = Symbol("review");
		reviewToken = token;
		pendingReview = false;
		const signal = scope.signal;
		const iteration = iterations.length;
		const plan = iterations[iteration - 1];
		const title = planTitle;
		try {
			while (!signal.aborted) {
				const actions: DocumentAction[] = [
					{ key: "a", label: "approve", value: "approve", primary: true },
					{ key: "r", label: "revise", value: "revise" },
					...(iteration > 1
						? ([
								{ key: "d", label: "diff", value: "diff" },
								{ key: "s", label: "summary", value: "summary" },
								{ key: "shift+s", label: "all changes", value: "allSummary" },
							] satisfies DocumentAction[])
						: []),
					{ key: "q", label: "Q&A", value: "qa" },
				];
				const action = await showDocument(
					ctx,
					{
						kind: "Plan review",
						title: title ?? "",
						meta: `iteration ${iteration}`,
						subtitle: planPath() ?? "",
						content: plan,
						actions,
					},
					signal,
				);
				if (signal.aborted) return;
				if (saves.pending && (action === "approve" || action === "revise")) {
					ctx.ui.notify("A plan update is being saved. Review it after the save completes.", "warning");
					continue;
				}
				if (iteration !== iterations.length && action !== "cancel") {
					pendingReview = true;
					ctx.ui.notify(
						"A newer plan is available. Opening the latest iteration before taking action.",
						"warning",
					);
					return;
				}
				if (action === "approve") {
					exitPlanMode(ctx, true);
					sendFollowUp(
						ctx,
						"I approve this plan. Execute the approved plan step by step. Here is the plan:\n\n" + plan,
					);
					return;
				}
				if (action === "revise") {
					const feedback = await requestRevision(ctx, signal);
					if (signal.aborted) return;
					if (iteration !== iterations.length || saves.pending) {
						pendingReview = true;
						ctx.ui.notify(
							"The plan changed while feedback was open. Review the latest iteration before revising.",
							"warning",
						);
						return;
					}
					if (!feedback?.trim()) continue;
					revisionPending = true;
					reminderRequested = false;
					persistState();
					sendFollowUp(
						ctx,
						"This feedback starts a plan revision discussion; do not call plan_output immediately unless the complete revision is already clear. You may respond in normal assistant text, ask me clarifying questions, or investigate further. If any material choice is unclear, ask before revising. Once the complete revised plan is ready, present it by calling plan_output.\n\nFeedback:\n" +
							feedback.trim(),
					);
					return;
				}
				if (action === "cancel") {
					renderPlanInChat(plan, iteration);
					ctx.ui.notify(
						"Review closed. Use /plan-review or Ctrl+Alt+O to reopen it, ask a question, or request a revision.",
						"info",
					);
					return;
				}
				if (action === "diff") await showDiff(ctx, signal);
				else if (action === "summary" || action === "allSummary")
					await showSummary(ctx, action === "allSummary", signal);
				else if (action === "qa") await showQA(ctx, signal);
			}
		} catch (error) {
			if (!signal.aborted) ctx.ui.notify(`Plan review failed: ${String(error)}`, "error");
		} finally {
			if (reviewToken === token) {
				reviewToken = undefined;
				if (pendingReview && !signal.aborted) void openPlanReview(ctx);
			}
		}
	}

	pi.registerTool({
		name: "plan_output",
		label: "Plan Output",
		description:
			"Present a complete implementation plan for interactive review when planning evidence is sufficient. Use again only when the user requests a revision or replacement.",
		promptSnippet: "Present the completed implementation plan for interactive review",
		exposure: "model-only",
		executionMode: "sequential",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		parameters: Type.Object({
			title: Type.String({ description: "Short descriptive title for the plan" }),
			plan: Type.String({
				description:
					"Full markdown plan covering outcome, evidence, impact, assumptions, implementation phases, validation, and material risks; include compatibility and rollout/backout when relevant.",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") throw new Error("Plan review requires TUI interactive mode.");
			const operationSignal = AbortSignal.any([scope.signal, ...(signal ? [signal] : [])]);
			return saves.run(async () => {
				operationSignal.throwIfAborted();
				const iteration = iterations.length + 1;
				const savedDir = await repository.save(planDir, params.title, params.plan, iteration, operationSignal);
				operationSignal.throwIfAborted();
				// Commit succeeded; only now publish the new in-memory/session state.
				planDir = savedDir;
				planTitle = params.title;
				iterations = [...iterations, params.plan];
				revisionPending = false;
				revisionReminder = undefined;
				reminderRequested = false;
				persistState();
				updateUI(ctx);
				pendingReview = true;
				return {
					content: [
						{
							type: "text",
							text: "Plan saved for interactive review. Do not continue until the user approves, requests revisions, or asks a follow-up question.",
						},
					],
					details: { presented: true, iteration, planDir: savedDir },
					terminate: true,
				};
			});
		},
		renderCall(args, theme, context) {
			const plain = (text: string, width: number) =>
				// Truncate plain text before styling it: truncateToWidth ends with a full reset, which
				// would also clear the tool box background for the rest of the row.
				stripTerminalSequences(truncateToWidth(text.replace(/\s+/gu, " ").trim(), width, "…"));
			const head =
				theme.fg("toolTitle", theme.bold("plan_output ")) +
				theme.fg("muted", plain(args.title || "Untitled", 60));
			// The model streams the whole plan as one tool argument, which can take a minute. Show it
			// growing so the row never looks stuck.
			const progress = context?.argsComplete === false ? planProgress(args.plan) : undefined;
			return new Text(progress ? head + "\n" + theme.fg("dim", plain(progress, 100)) : head, 0, 0);
		},
		renderResult(result, options, theme, context) {
			const text = getMessageText(result.content);
			if (context.isError) return new Text(theme.fg("error", text || "Plan presentation failed."), 0, 0);
			if (options.isPartial) return new Text(theme.fg("muted", "Saving plan…"), 0, 0);
			if (Check(outputDetailsSchema, result.details))
				return new Text(
					theme.fg("muted", `▣ Plan ready for review (iteration ${result.details.iteration})`),
					0,
					0,
				);
			return new Text(text || "No plan presentation result available.", 0, 0);
		},
	});

	pi.registerFlag("plan", { description: "Start in plan mode", type: "boolean", default: false });
	const toggle = (ctx: ExtensionContext) => {
		if (active) exitPlanMode(ctx);
		else enterPlanMode(ctx);
	};
	const reopen = async (ctx: ExtensionContext) => {
		if (!requireTui(ctx)) return;
		if (!iterations.length) {
			ctx.ui.notify("No plan has been presented yet.", "warning");
			return;
		}
		if (reviewToken) {
			ctx.ui.notify("The plan review is already open.", "info");
			return;
		}
		await openPlanReview(ctx);
	};
	pi.registerCommand("plan", {
		description: "Toggle plan mode (evidence-guided planning and review)",
		handler: async (_args, ctx) => toggle(ctx),
	});
	pi.registerCommand("plan-review", {
		description: "Reopen the latest plan review",
		handler: async (_args, ctx) => reopen(ctx),
	});
	pi.registerShortcut(Key.alt("p"), { description: "Toggle plan mode", handler: async (ctx) => toggle(ctx) });
	pi.registerShortcut(Key.ctrlAlt("o"), { description: "Reopen the latest plan review", handler: reopen });
	pi.registerShortcut(Key.ctrlAlt("d"), {
		description: "Show plan diff",
		handler: async (ctx) => {
			if (active) await showDiff(ctx);
		},
	});
	pi.registerShortcut(Key.ctrlAlt("s"), {
		description: "Show plan change summary",
		handler: async (ctx) => {
			if (active) await showSummary(ctx, false);
		},
	});
	pi.registerShortcut(Key.ctrlAlt("a"), {
		description: "Show summary of all plan changes",
		handler: async (ctx) => {
			if (active) await showSummary(ctx, true);
		},
	});
	pi.registerShortcut(Key.ctrlAlt("q"), { description: "Show plan Q&A history", handler: showQA });

	pi.on("input", (event) => {
		if (!active || event.source === "extension" || event.streamingBehavior === "steer") return;
		lastUserInputText = event.text;
		lastUserInputPlanIteration = iterations.length;
		reminderRequested = false;
		if (iterations.length && isPlanRevisionIntent(event.text)) {
			revisionPending = true;
			persistState();
		}
	});
	pi.on("tool_call", (event) => {
		if (!active || event.toolName !== "plan_output" || !iterations.length || revisionPending) return;
		if (lastUserInputPlanIteration === iterations.length && isPlanRevisionIntent(lastUserInputText)) return;
		return {
			block: true,
			terminate: true,
			reason: "Plan mode: plan_output is only for a new or explicitly requested revised plan. Answer clarification and follow-up questions normally without changing the saved plan. Ask if revision intent is unclear.",
		};
	});
	pi.on("agent_start", (_event, ctx) => {
		if (active) {
			isAgentWorking = true;
			updateUI(ctx);
		}
	});
	pi.on("agent_settled", (event, ctx) => {
		isAgentWorking = false;
		updateUI(ctx);
		// Open only after the tool result and all automatic work have settled.
		// Do not await user input inside an agent lifecycle dispatch.
		if (event.aborted) pendingReview = false;
		else if (pendingReview) void openPlanReview(ctx);
	});
	pi.on("message_end", (event) => {
		if (!active) return;
		const message = event.message;
		if (
			message.role === "assistant" &&
			message.content.some((part) => part.type === "toolCall" && part.name === "plan_output")
		)
			return;
		if (message.role !== "assistant" && message.role !== "user") return;
		const text = getMessageText(message.content);
		if (!text.trim()) return;
		if (revisionPending && message.role === "assistant" && assistantTextLooksLikePlan(text)) {
			if (!reminderRequested) {
				reminderRequested = true;
				revisionReminder =
					"Plan mode revision is pending. Present the complete revised plan with plan_output, not in normal assistant text. If more information is needed, ask a concise clarification question instead.";
			}
			const replacement =
				"△ Plan revision is pending. The complete revised plan must be presented through plan_output for review.";
			qaMessages.push({ role: "assistant", content: replacement });
			persistState();
			return { message: { ...message, content: [{ type: "text", text: replacement }] } };
		}
		qaMessages.push({ role: message.role, content: text });
		persistState();
	});
	pi.on("agent_before_settle", (event) => {
		if (!revisionReminder || event.outcome !== "completed" || !event.context.canContinue) return;
		const reminder = revisionReminder;
		revisionReminder = undefined;
		return {
			entries: [{ type: "custom_message", customType: REMINDER_TYPE, content: reminder, display: false }],
			continue: true,
		};
	});
	pi.on("before_agent_start", (event) => {
		if (!active) return;
		event.systemPromptOptions.sections.plan_mode = buildPlanModeSystemPrompt({
			planPresented: iterations.length > 0,
			iterationCount: iterations.length,
			planTitle,
			revisionPending,
		});
	});
	pi.on("context", (event) => ({
		messages: event.messages.filter((message) => {
			if (message.role !== "custom") return true;
			return (
				message.customType !== PLAN_RENDER_MESSAGE_TYPE &&
				(active || (message.customType !== "plan-mode-context" && message.customType !== REMINDER_TYPE))
			);
		}),
	}));
	pi.on("session_start", (_event, ctx) => {
		restoreState(ctx);
		if (pi.getFlag("plan") === true && ctx.mode === "tui") enterPlanMode(ctx);
		else updateUI(ctx);
	});
	pi.on("session_tree", (_event, ctx) => {
		restoreState(ctx);
		updateUI(ctx);
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		scope.abort();
		pendingReview = false;
		reviewToken = undefined;
		await saves.idle();
		if (ctx.mode === "tui") {
			ctx.ui.setWorkingVisible(true);
			ctx.ui.setStatus("plan-mode", undefined);
		}
	});
}
