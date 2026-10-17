const PLAN_MODE_SYSTEM_PROMPT_HEADER = `[PLAN MODE ACTIVE]`;

export type PlanModePromptState = {
	planPresented: boolean;
	iterationCount: number;
	planTitle: string | null;
	revisionPending: boolean;
};

export type PersistedPlanModeState = {
	active?: boolean;
	planDir?: string | null;
	iterations?: string[];
	planTitle?: string | null;
	qaMessages?: Array<{ role: "user" | "assistant"; content: string }>;
	revisionPending?: boolean;
};

function formatPlanModeState(state: PlanModePromptState | undefined): string {
	if (!state?.planPresented) {
		return "- No plan has been presented yet in this plan-mode session.";
	}

	const lines = [
		`- A plan has already been presented (${state.iterationCount} iteration${state.iterationCount === 1 ? "" : "s"}).`,
	];
	if (state.planTitle) lines.push(`- Current plan title: ${state.planTitle}`);
	if (state.revisionPending) {
		lines.push(
			"- A revision is pending. Discuss feedback, investigate, and ask about unresolved choices before revising. Call plan_output when the complete revised plan is ready, not in place of discussion. Do not put the revised plan in assistant text.",
		);
	} else {
		lines.push(
			"- The user may ask normal follow-up questions about the plan; answer those in regular assistant text.",
		);
	}
	return lines.join("\n");
}

export function isPlanRevisionIntent(text: string): boolean {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
	if (!normalized) return false;

	const explicitRevision =
		/\b(revise|revision|update|change|modify|edit|adjust|rework|rewrite|regenerate|redo|replan|amend)\b/.test(
			normalized,
		) ||
		/\b(add|include|incorporate|remove|exclude|drop|expand|shorten|tighten|simplify)\b/.test(normalized) ||
		/\b(plan should|new plan|another plan|updated plan|revised plan)\b/.test(normalized);

	if (!explicitRevision) return false;

	const clarificationOnly =
		/\b(why|what|how|explain|clarify|question|rationale|tell me|help me understand)\b/.test(normalized) &&
		!/\b(to the plan|in the plan|the plan|plan should|updated plan|revised plan)\b/.test(normalized);

	return !clarificationOnly;
}

type MessageContentPart = { type?: string; text?: string; name?: string };

export function getMessageContentParts(content: unknown): MessageContentPart[] {
	return Array.isArray(content)
		? (content.filter((part) => part && typeof part === "object") as MessageContentPart[])
		: [];
}

export function getMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	return getMessageContentParts(content)
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("\n");
}

export function assistantTextLooksLikePlan(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < 500) return false;

	const normalized = trimmed.toLowerCase();
	if (/\b(here(?:'s| is) (?:the )?(?:(?:revised|updated)\s+)?(?:implementation\s+)?plan)\b/.test(normalized))
		return true;
	if (/\b(?:revised|updated) (?:implementation )?plan\b/.test(normalized) && /\n\s*#{1,3}\s+/.test(trimmed))
		return true;

	const sectionHeadings = [
		/^\s*#{1,3}\s+goal\b/im,
		/^\s*#{1,3}\s+(findings|context|current-state findings)\b/im,
		/^\s*#{1,3}\s+impact analysis\b/im,
		/^\s*#{1,3}\s+(proposed approach|approach)\b/im,
		/^\s*#{1,3}\s+(implementation|phases|ordered implementation phases)\b/im,
		/^\s*#{1,3}\s+validation\b/im,
		/^\s*#{1,3}\s+(risks|unknowns|risks\/unknowns)\b/im,
		/^\s*#{1,3}\s+(rollout|backout|rollout\/backout)\b/im,
	];
	const matchingSections = sectionHeadings.filter((pattern) => pattern.test(trimmed)).length;
	return matchingSections >= 3;
}

export function buildPlanModeSystemPrompt(state?: PlanModePromptState): string {
	return `
${PLAN_MODE_SYSTEM_PROMPT_HEADER}

Goal:
Write a plan another engineer can implement. Define the outcome, scope, affected code and interfaces, risks, and validation. Explain constraints and the order of work without prescribing every edit or command.

Current plan state:
${formatPlanModeState(state)}

Decision rules:
- Inspect the repository, documentation, or external sources when they could change the plan's correctness, scope, impact, or assumptions. Avoid unrelated exploration.
- You may perform read-only research and low-risk validation to test planning assumptions. Use the least invasive method. Do not intentionally modify source files or tracked project state.
- Ask the user when the evidence leaves a choice unresolved and the answer would change the outcome, scope, compatibility, risk, or validation. Otherwise proceed and state the assumption.
- Separate verified findings, assumptions, and open questions. Gather enough detail for another engineer to implement the plan; do not try to resolve every possible uncertainty.

Approval:
- Before approval, do not implement the plan, edit project files, or perform destructive, irreversible, production, or external mutations.
- Approval of the reviewed plan authorizes its implementation, subject to normal safety and permission constraints.
- When the plan is ready, present it with plan_output and stop for user review.

After presenting a plan:
- Answer follow-up questions and discuss rationale or trade-offs in normal assistant text without replacing the saved plan.
- Use plan_output again only for an explicit plan revision or replacement, including revision feedback from the review UI.
- If revision intent is ambiguous, clarify whether the user wants the saved plan changed.
- Discuss revision feedback in normal assistant text. Ask about unresolved choices before revising. Call plan_output only when the complete revised plan is ready; do not put that plan in assistant text.

Plan content:
Organize the plan for the task. Cover the outcome and success criteria, current-state evidence, affected and preserved behavior, assumptions or open questions, implementation phases, validation, and risks. Include compatibility, migration, rollout, or backout when relevant. Name affected files and interfaces when known. Omit sections that do not apply.
`.trim();
}
