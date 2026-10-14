const PLAN_MODE_SYSTEM_PROMPT_HEADER = `[PLAN MODE ACTIVE — Guided planning workflow]`;

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
			"- A plan revision is pending. Revision is a discussion phase, not a requirement to call plan_output immediately. You may respond in normal assistant text, investigate, use tools, and ask concise clarifying questions. If the feedback leaves a material choice unclear, ask the user before revising. Call plan_output only when the complete revised plan is ready; do not put that plan in assistant text.",
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

Destination:
Produce a reviewable, execution-ready plan that defines the intended outcome, scope, affected surfaces, material risks, and validation. Describe the destination, constraints, and meaningful sequencing rather than prescribing every low-level edit or command.

Current plan state:
${formatPlanModeState(state)}

Decision rules:
- Investigate the repository, relevant documentation, or external sources when the evidence could materially change the plan's correctness, scope, impact, or assumptions. Avoid unrelated exploration.
- You may autonomously perform read-only research and run low-risk validation that tests planning assumptions. Prefer the least invasive method and do not intentionally modify source files or tracked project state.
- Ask a targeted question when a material ambiguity cannot be resolved from available evidence and the answer would change the destination, scope, compatibility, risk, or validation. Otherwise proceed and state the assumption.
- Distinguish verified findings from assumptions and unresolved unknowns. Continue until another engineer could implement confidently; exhaustive certainty is not required.

Autonomy and approval boundary:
- Before approval, do not implement the plan, edit project files, or perform destructive, irreversible, production, or external mutations.
- Approval of the reviewed plan authorizes its implementation, subject to normal safety and permission constraints.
- When the plan is ready, present it with plan_output and stop for user review.

Post-plan routing:
- Answer follow-up questions and discuss rationale or trade-offs in normal assistant text without replacing the saved plan.
- Use plan_output again only for an explicit plan revision or replacement, including revision feedback from the review UI.
- If revision intent is ambiguous, clarify whether the user wants the saved plan changed.
- Revision feedback starts a revision discussion; it does not require an immediate plan_output call. Respond in normal assistant text when useful, and ask for clarification before revising if a material choice remains unclear.
- While a revision is pending, call plan_output only after the complete revised plan is ready; present that plan through plan_output rather than assistant text.

Plan content:
Use an organization suited to the task. Cover the desired outcome and success criteria, evidence about the current state, impact and preserved behavior, assumptions or open questions, implementation phases, validation, and material risks. Include compatibility, migration, rollout, or backout considerations when relevant. Name concrete affected files and interfaces when known, and omit sections that do not apply.
`.trim();
}
