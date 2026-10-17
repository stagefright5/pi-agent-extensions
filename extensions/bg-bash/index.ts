import { type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Key, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { jobTail, JobsBrowser } from "./browser.ts";
import { FooterStatus, STATUS_ID } from "./footer.ts";
import { formatDuration, jobManager, type Job } from "./jobs.ts";
import { registerStatusAction } from "./status-action.ts";
import { createBashTool, createJobTools, type ShellSettings } from "./tools.ts";

export const MESSAGE_TYPE = "bg-job";
const MESSAGE_TAIL_LINES = 40;

export type JobMessageDetails = {
	id: string;
	state: Job["state"];
	exitCode: number | null;
	durationMs: number;
	command: string;
	logPath?: string;
	tail: string;
	stoppedBy?: "user" | "agent";
};

function succeeded(details: Pick<JobMessageDetails, "state" | "exitCode">): boolean {
	return details.state === "exited" && details.exitCode === 0;
}

function outcome(details: Pick<JobMessageDetails, "state" | "exitCode" | "stoppedBy">): string {
	if (details.state === "timed-out") return "timed out";
	if (details.state === "killed") return details.stoppedBy === "user" ? "was stopped by the user" : "was killed";
	return `exited with code ${details.exitCode}`;
}

export function jobMessage(job: Job): { content: string; details: JobMessageDetails } {
	const details: JobMessageDetails = {
		id: job.id,
		state: job.state,
		exitCode: job.exitCode,
		durationMs: job.elapsedMs(),
		command: job.command,
		logPath: job.logPath,
		tail: jobTail(job, MESSAGE_TAIL_LINES),
		...(job.stoppedBy ? { stoppedBy: job.stoppedBy } : {}),
	};
	const content =
		`Background job ${job.id} ${outcome(details)} after ${formatDuration(details.durationMs)}: ${job.command}\n` +
		`Log: ${job.logPath ?? "(none)"}\n\n` +
		(details.tail ? `Last ${MESSAGE_TAIL_LINES} lines:\n${details.tail}` : "(no output)");
	return { content, details };
}

/** Transcript row for a finish message: one line, expanding to the output tail. Cached per width. */
class JobMessageComponent implements Component {
	private cache: { width: number; lines: string[] } | undefined;
	private readonly details: JobMessageDetails;
	private readonly expanded: boolean;
	private readonly theme: Theme;

	constructor(details: JobMessageDetails, expanded: boolean, theme: Theme) {
		this.details = details;
		this.expanded = expanded;
		this.theme = theme;
	}

	invalidate(): void {
		this.cache = undefined;
	}

	render(width: number): string[] {
		if (this.cache?.width === width) return this.cache.lines;
		const { theme, details } = this;
		const ok = succeeded(details);
		const color = ok ? "success" : details.stoppedBy === "user" ? "warning" : "error";
		const summary =
			`${theme.fg(color, "○")} ${theme.fg("accent", details.id)} ` +
			theme.fg("muted", `${outcome(details)} · ${formatDuration(details.durationMs)} · `) +
			theme.fg("dim", details.command.replace(/\s+/gu, " "));
		const lines = [truncateToWidth(summary, width, "…")];
		if (this.expanded && details.tail) {
			for (const line of details.tail.split("\n")) {
				for (const row of wrapTextWithAnsi(line, Math.max(1, width - 2)))
					lines.push(`  ${theme.fg("toolOutput", row)}`);
			}
		}
		this.cache = { width, lines };
		return lines;
	}
}

const EXIT_HOOK = Symbol.for("@stagefright5/pi-bg-bash/exit-hook");

export default function backgroundBash(pi: ExtensionAPI): void {
	const manager = jobManager();
	let session = "default";
	let shell: ShellSettings = {};
	let context: ExtensionContext | undefined;
	let footer: FooterStatus | undefined;
	let offChange: (() => void) | undefined;
	let offAction: (() => void) | undefined;
	let browserOpen = false;

	const options = { manager, session: () => session, shell: () => shell };
	pi.registerTool(createBashTool(options));
	for (const tool of createJobTools(options)) pi.registerTool(tool);

	pi.registerMessageRenderer<JobMessageDetails>(MESSAGE_TYPE, (message, { expanded }, theme) =>
		message.details ? new JobMessageComponent(message.details, expanded, theme) : undefined,
	);

	/**
	 * Tell the agent about a background job that finished on its own or that the user stopped from the
	 * jobs manager. Jobs the agent stopped (job_kill) or already read are not reported.
	 */
	const notify = (job: Job) => {
		if (!job.backgrounded || job.state === "running" || job.notified || job.agentSeen) return;
		if (job.killedByUser && job.stoppedBy !== "user") return;
		job.notified = true;
		const { content, details } = jobMessage(job);
		pi.sendMessage<JobMessageDetails>(
			{ customType: MESSAGE_TYPE, display: true, content, details },
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	};

	async function openJobs(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") {
			if (ctx.hasUI)
				ctx.ui.notify(
					"The jobs manager needs the interactive terminal UI; use job_status without an id instead",
					"warning",
				);
			return;
		}
		if (browserOpen) return;
		if (manager.size === 0) {
			ctx.ui.notify("No background jobs", "info");
			return;
		}
		browserOpen = true;
		try {
			await ctx.ui.custom<void>(
				(tui, _theme, keybindings, done) =>
					new JobsBrowser({
						tui,
						theme: () => ctx.ui.theme,
						keybindings,
						manager,
						done: () => done(),
						sendToAgent: (text) => pi.sendUserMessage(text, { deliverAs: "followUp" }),
					}),
				{ overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 50, maxHeight: "50%" } },
			);
		} finally {
			browserOpen = false;
		}
	}

	pi.registerCommand("jobs", {
		description: "Browse, inspect, and stop background bash jobs",
		handler: async (_args, ctx) => openJobs(ctx),
	});
	pi.registerShortcut(Key.alt("j"), {
		description: "Open the background jobs manager",
		handler: (ctx) => openJobs(ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		context = ctx;
		session = ctx.sessionManager.getSessionId();
		const settings = pi.getSettings();
		shell = { shellPath: settings.shellPath, commandPrefix: settings.shellCommandPrefix };
		const store = globalThis as typeof globalThis & { [EXIT_HOOK]?: boolean };
		if (!store[EXIT_HOOK]) {
			// Detached process groups would outlive pi; stop them when the process exits.
			store[EXIT_HOOK] = true;
			process.once("exit", () => jobManager().killAll());
		}
		footer = ctx.hasUI
			? new FooterStatus(
					manager,
					() => ctx.ui.theme,
					(text) => ctx.ui.setStatus(STATUS_ID, text),
				)
			: undefined;
		offChange?.();
		offChange = manager.onChange((job, change) => {
			if (change !== "state") return;
			footer?.update();
			notify(job);
		});
		if (ctx.mode === "tui") {
			offAction?.();
			offAction = registerStatusAction(STATUS_ID, {
				label: "jobs",
				activate: () => {
					if (context) void openJobs(context);
				},
			});
		}
		// Jobs kept across /reload: show them, and report any that finished while reloading.
		footer?.update();
		for (const job of manager.list()) notify(job);
	});

	pi.on("session_shutdown", async (event) => {
		offChange?.();
		offChange = undefined;
		offAction?.();
		offAction = undefined;
		footer?.clear();
		footer = undefined;
		context = undefined;
		// Reload replaces this runtime but keeps the session: let builds keep running.
		if (event.reason !== "reload") await manager.reset();
	});
}
