/**
 * Plan review UI: the review, diff, summary and Q&A documents, the revision editor and the summary
 * loader all open in pi-dialog popups. The inline transcript card stays here.
 */
import { getMarkdownTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, type Component, type KeyId } from "@earendil-works/pi-tui";
import {
	editor,
	showDocument as showDocumentPopup,
	singleLine,
	spread,
	tildePath,
	withLoader as withLoaderPopup,
} from "@stagefright5/pi-dialog";

export type ReviewAction = "approve" | "revise" | "cancel" | "diff" | "summary" | "allSummary" | "qa";
export interface DocumentAction {
	key: KeyId;
	label: string;
	value: ReviewAction;
	/** Drawn as the one emphasised action. */
	primary?: boolean;
}
export interface DocumentOptions {
	/** What the view is, e.g. "Plan review"; drawn in the accent colour before the title. */
	kind?: string;
	title: string;
	/** Right side of the header, e.g. "iteration 2". */
	meta?: string;
	subtitle?: string;
	content: string;
	format?: "markdown" | "diff";
	actions?: readonly DocumentAction[];
}

/** Review, diff, summary and Q&A popups. Esc, Ctrl+C and the signal resolve "cancel". */
export async function showDocument(
	ctx: ExtensionContext,
	options: DocumentOptions,
	signal: AbortSignal,
): Promise<ReviewAction> {
	return showDocumentPopup<ReviewAction>(ctx, { ...options, icon: "◆" }, signal);
}

/** Pi's native multi-line editor in a popup, with explicit workflow cancellation. */
export async function requestRevision(ctx: ExtensionContext, signal: AbortSignal): Promise<string | undefined> {
	return editor(ctx, {
		title: "Revise plan",
		message: "What changes would you like to the plan?",
		signal,
	});
}

export async function withLoader<T>(
	ctx: ExtensionContext,
	label: string,
	signal: AbortSignal,
	work: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
	return withLoaderPopup(ctx, label, signal, work, {
		title: "Plan summary",
		onError: (error) => ctx.ui.notify(`Unable to generate summary: ${String(error)}`, "error"),
	});
}

/** Keep inline transcript rendering within the viewport width. */
export function createPlanMessageComponent(
	plan: string,
	title: string | null,
	iteration: number,
	path: string | null,
	theme: Theme,
): Component {
	const markdown = new Markdown(plan, 0, 0, getMarkdownTheme());
	return {
		render(width) {
			if (width <= 0) return [];
			const heading =
				theme.fg("accent", theme.bold("Plan")) + (title ? `  ${theme.bold(singleLine(title))}` : "");
			return [
				spread(heading, theme.fg("dim", `iteration ${iteration}`), width),
				...(path ? [theme.fg("dim", tildePath(singleLine(path)))] : []),
				theme.fg("borderMuted", "─".repeat(width)),
				"",
				...markdown.render(width),
			].map((line) => truncateToWidth(line, width, ""));
		},
		invalidate: () => markdown.invalidate(),
	};
}
