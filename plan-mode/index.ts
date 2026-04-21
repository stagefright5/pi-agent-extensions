/**
 * Plan Mode Extension
 *
 * Interactive planning mode that activates with Alt+P or /plan.
 * Forces the agent to ask clarifying questions before creating plans.
 * Plans are rendered in markdown, tracked in a per-plan git repo,
 * and tool availability is preserved while the agent prepares a plan.
 *
 * Shortcuts (in plan review UI):
 *   a        — approve plan
 *   r        — revise (opens editor for feedback)
 *   d        — show diff between current and previous iteration
 *   s        — generate LLM summary of changes (prev → current)
 *   S        — generate LLM summary of ALL changes across iterations
 *   q        — show Q&A history
 *   ↑↓/j/k   — scroll plan
 *   PgUp/PgDn — page scroll
 *   esc       — close review (continue conversation)
 *
 * Global shortcuts (while in plan mode, outside review UI):
 *   alt+p       — toggle plan mode
 *   ctrl+alt+d  — show diff
 *   ctrl+alt+s  — show change summary
 *   ctrl+alt+a  — show all-changes summary
 *   ctrl+alt+q  — show Q&A history
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { BorderedLoader, DynamicBorder, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { Container, Key, Markdown, matchesKey, Spacer, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateSlug } from "./utils.js";

// ─── Constants ──────────────────────────────────────────────

const PLAN_MODE_SYSTEM_PROMPT = `
[PLAN MODE ACTIVE — Guided planning workflow]

You are in plan mode. Your goal is to help the user create a comprehensive, well-thought-out plan BEFORE any code changes are made.

CRITICAL RULES:
1. ALWAYS ask clarifying questions before creating a plan. NEVER assume.
   Ask about: scope, constraints, preferences, edge cases, dependencies,
   success criteria, and anything else that is unclear.
2. Go back and forth with the user. Have a real conversation. Don't rush to a plan.
3. When you have gathered enough information and are confident, present the plan
   by calling the plan_output tool with a descriptive title and full markdown plan.
4. Do NOT execute the plan yet. You may inspect the codebase and use available tools
   to understand the task, but wait for explicit user approval before making changes.
5. Structure plans with clear phases/sections, numbered steps, expected outcomes,
   risk considerations, and dependency ordering.
6. If the user asks you to revise after reviewing, incorporate their feedback
   and call plan_output again with the updated plan.
`.trim();

type ReviewAction = "approve" | "revise" | "cancel" | "diff" | "summary" | "allSummary" | "qa";

// ─── Extension ──────────────────────────────────────────────

export default function planModeExtension(pi: ExtensionAPI): void {
	// ─── State ──────────────────────────────────────────────

	let active = false;
	let planDir: string | null = null;
	let iterations: string[] = []; // full markdown text per iteration
	let planTitle: string | null = null;
	let qaMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

	const PLANS_BASE = join(homedir(), ".pi", "plans");

	// ─── Git Helpers ────────────────────────────────────────

	async function gitExec(dir: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
		return pi.exec("git", ["-C", dir, ...args], { timeout: 10_000 });
	}

	async function initPlanRepo(dir: string): Promise<void> {
		await mkdir(dir, { recursive: true });
		await gitExec(dir, ["init"]);
		// Seed with an empty commit so HEAD~1 works after the first plan commit
		await writeFile(join(dir, ".gitkeep"), "", "utf-8");
		await gitExec(dir, ["add", "."]);
		await gitExec(dir, ["commit", "-m", "init plan repo"]);
	}

	async function savePlanAndCommit(dir: string, content: string, iteration: number): Promise<void> {
		await writeFile(join(dir, "plan.md"), content, "utf-8");
		await gitExec(dir, ["add", "plan.md"]);
		await gitExec(dir, ["commit", "-m", `Plan iteration ${iteration}`]);
	}

	async function getLastDiff(dir: string): Promise<string> {
		try {
			const { stdout } = await gitExec(dir, ["diff", "HEAD~1", "HEAD", "--", "plan.md"]);
			return stdout;
		} catch {
			return "";
		}
	}

	async function getFullDiff(dir: string): Promise<string> {
		try {
			// diff from the very first commit (the seed) to HEAD
			const { stdout: revList } = await gitExec(dir, ["rev-list", "--max-parents=0", "HEAD"]);
			const first = revList.trim().split("\n")[0];
			if (!first) return "";
			const { stdout } = await gitExec(dir, ["diff", first, "HEAD", "--", "plan.md"]);
			return stdout;
		} catch {
			return "";
		}
	}

	// ─── UI Helpers ─────────────────────────────────────────

	function updateUI(ctx: ExtensionContext): void {
		const t = ctx.ui.theme;
		if (active) {
			const iterInfo = iterations.length > 0 ? ` v${iterations.length}` : "";
			ctx.ui.setStatus("plan-mode", t.fg("warning", `📋 PLAN${iterInfo}`));

			const widgetLines: string[] = [];
			widgetLines.push(
				t.fg("accent", "📋 Plan Mode") +
					(planTitle ? t.fg("muted", ` — ${planTitle}`) : "") +
					(iterations.length > 0
						? t.fg("dim", ` (${iterations.length} iteration${iterations.length !== 1 ? "s" : ""})`)
						: ""),
			);
			const hints: string[] = [];
			if (iterations.length > 1) {
				hints.push("ctrl+alt+d diff", "ctrl+alt+s summary", "ctrl+alt+a all changes");
			}
			hints.push("ctrl+alt+q Q&A");
			widgetLines.push(t.fg("dim", `  ${hints.join("  │  ")}`));
			ctx.ui.setWidget("plan-mode", widgetLines);
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
			ctx.ui.setWidget("plan-mode", undefined);
		}
	}

	function enableMouseWheel(tui: Container & { terminal?: { write(data: string): void } }): () => void {
		// Enable basic mouse tracking + SGR extended coordinates so wheel events
		// arrive as escape sequences like ESC [ < 64 ; x ; y M.
		tui.terminal?.write("\x1b[?1000h\x1b[?1006h");

		let cleanedUp = false;
		return () => {
			if (cleanedUp) return;
			cleanedUp = true;
			tui.terminal?.write("\x1b[?1000l\x1b[?1006l");
		};
	}

	function getMouseWheelDelta(data: string): -1 | 1 | null {
		// SGR mouse reporting: ESC [ < code ; col ; row M
		const match = data.match(/^\x1b\[<(\d+);\d+;\d+[mM]$/);
		if (!match) return null;

		const code = Number.parseInt(match[1] ?? "", 10);
		if (Number.isNaN(code) || (code & 64) === 0) return null;
		return (code & 1) === 0 ? -1 : 1;
	}

	// ─── Enter / Exit ───────────────────────────────────────

	function enterPlanMode(ctx: ExtensionContext): void {
		active = true;
		planDir = null;
		iterations = [];
		planTitle = null;
		qaMessages = [];

		ctx.ui.notify("📋 Plan mode activated. The agent will ask questions before creating a plan.", "info");
		updateUI(ctx);
		persistState();
	}

	function exitPlanMode(ctx: ExtensionContext, approved = false): void {
		active = false;
		ctx.ui.notify(approved ? "✅ Plan approved! Plan mode deactivated." : "📋 Plan mode deactivated.", "info");
		updateUI(ctx);
		persistState();
	}

	// ─── State Persistence ──────────────────────────────────

	function persistState(): void {
		pi.appendEntry("plan-mode-interactive", {
			active,
			planDir,
			iterations,
			planTitle,
			qaMessages,
		});
	}

	// ─── Diff UI ────────────────────────────────────────────

	async function showDiffUI(ctx: ExtensionContext): Promise<void> {
		if (!planDir || iterations.length < 2) {
			ctx.ui.notify("Need at least 2 iterations to show a diff.", "warning");
			return;
		}
		const diff = await getLastDiff(planDir);
		if (!diff.trim()) {
			ctx.ui.notify("No changes between the last two iterations.", "info");
			return;
		}

		await ctx.ui.custom(
			(tui, theme, _kb, done) => {
				const cleanupMouse = enableMouseWheel(tui);
				const finish = () => {
					cleanupMouse();
					done(undefined);
				};
				let scrollOffset = 0;
				let cachedDiffLines: string[] | null = null;
				let cachedWidth: number | null = null;

				return {
					render(width: number): string[] {
						const innerWidth = Math.max(20, width - 4);
						if (!cachedDiffLines || cachedWidth !== width) {
							cachedDiffLines = diff
								.split("\n")
								.flatMap((line) => {
									const styled = (() => {
										if (line.startsWith("+++") || line.startsWith("---")) return theme.fg("muted", line);
										if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
										if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
										if (line.startsWith("@@")) return theme.fg("accent", line);
										return theme.fg("dim", line);
									})();
									const wrapped = wrapTextWithAnsi(styled, innerWidth);
									return wrapped.length > 0 ? wrapped : [""];
								});
							cachedWidth = width;
						}

						const modalHeight = Math.max(10, Math.floor((process.stdout.rows || 24) * 0.85));
						const headerFooterLines = 7;
						const viewportHeight = Math.max(5, modalHeight - headerFooterLines);
						const maxScroll = Math.max(0, cachedDiffLines.length - viewportHeight);
						if (scrollOffset > maxScroll) scrollOffset = maxScroll;

						const lines: string[] = [];
						lines.push(theme.fg("accent", `╭${"─".repeat(Math.max(0, width - 2))}╮`));
						lines.push(
							truncateToWidth(
								theme.fg("accent", "│ ") +
									theme.fg("accent", theme.bold(`📋 Diff: Iteration ${iterations.length - 1} → ${iterations.length}`)) +
									(planTitle ? `  ${theme.fg("dim", planTitle)}` : "") +
									theme.fg("accent", " │"),
								width,
							),
						);
						lines.push(theme.fg("accent", `├${"─".repeat(Math.max(0, width - 2))}┤`));

						const visible = cachedDiffLines.slice(scrollOffset, scrollOffset + viewportHeight);
						for (const line of visible) {
							lines.push(theme.fg("accent", "│ ") + truncateToWidth(line, innerWidth) + theme.fg("accent", " │"));
						}
						for (let i = visible.length; i < viewportHeight; i++) {
							lines.push(theme.fg("accent", "│") + " ".repeat(Math.max(0, width - 2)) + theme.fg("accent", "│"));
						}

						if (cachedDiffLines.length > viewportHeight) {
							const pct = maxScroll > 0 ? Math.round((scrollOffset / maxScroll) * 100) : 100;
							const info = truncateToWidth(theme.fg("dim", ` ${pct}% (${cachedDiffLines.length} lines) `), innerWidth);
							lines.push(
								theme.fg("accent", "│ ") +
									info +
									" ".repeat(Math.max(0, innerWidth - visibleWidth(info))) +
									theme.fg("accent", " │"),
							);
						} else {
							lines.push(theme.fg("accent", "│") + " ".repeat(Math.max(0, width - 2)) + theme.fg("accent", "│"));
						}

						const help = truncateToWidth(
							theme.fg("dim", " ↑↓/j/k scroll  PgUp/PgDn page  mouse wheel scroll  Enter/Esc close "),
							innerWidth,
						);
						lines.push(
							theme.fg("accent", "│ ") +
								help +
								" ".repeat(Math.max(0, innerWidth - visibleWidth(help))) +
								theme.fg("accent", " │"),
						);
						lines.push(theme.fg("accent", `╰${"─".repeat(Math.max(0, width - 2))}╯`));
						return lines;
					},
					invalidate() {
						cachedDiffLines = null;
						cachedWidth = null;
					},
					handleInput(data: string) {
						const modalHeight = Math.max(10, Math.floor((process.stdout.rows || 24) * 0.85));
						const viewportHeight = Math.max(5, modalHeight - 7);
						const maxScroll = cachedDiffLines ? Math.max(0, cachedDiffLines.length - viewportHeight) : 0;
						const wheelDelta = getMouseWheelDelta(data);

						if (wheelDelta !== null) {
							scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + wheelDelta * 3));
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.up) || data === "k") {
							scrollOffset = Math.max(0, scrollOffset - 1);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.down) || data === "j") {
							scrollOffset = Math.min(maxScroll, scrollOffset + 1);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.pageUp)) {
							scrollOffset = Math.max(0, scrollOffset - viewportHeight);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.pageDown)) {
							scrollOffset = Math.min(maxScroll, scrollOffset + viewportHeight);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) {
							finish();
						}
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "85%",
					minWidth: 60,
					maxHeight: "85%",
					margin: 1,
				},
			},
		);
	}

	// ─── Summary UI ─────────────────────────────────────────

	async function showSummaryUI(ctx: ExtensionContext, allChanges: boolean): Promise<void> {
		if (iterations.length < 2) {
			ctx.ui.notify("Need at least 2 iterations to generate a summary.", "warning");
			return;
		}

		const model = ctx.model;
		if (!model) {
			ctx.ui.notify("No model available for summary generation.", "error");
			return;
		}
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth?.ok || !auth.apiKey) {
			ctx.ui.notify("No API key available for summary generation.", "error");
			return;
		}

		// Generate with a loading spinner
		const summary = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(
				tui,
				theme,
				allChanges ? "Generating summary of all changes…" : "Generating change summary…",
			);
			loader.onAbort = () => done(null);

			(async () => {
				try {
					let prompt: string;
					if (allChanges) {
						const versions = iterations.map((p, i) => `### Version ${i + 1}\n${p}`).join("\n\n---\n\n");
						prompt =
							`Summarize ALL the changes across these ${iterations.length} plan iterations. ` +
							`What evolved, what was added, removed, or restructured? Be concise and use markdown.\n\n${versions}`;
					} else {
						const prev = iterations[iterations.length - 2];
						const curr = iterations[iterations.length - 1];
						prompt =
							"Summarize the changes between these two plan versions. " +
							"What was added, removed, or modified? Be concise and use markdown.\n\n" +
							`### Previous Version\n${prev}\n\n### Current Version\n${curr}`;
					}

					const response = await complete(
						model,
						{
							messages: [
								{
									role: "user" as const,
									content: [{ type: "text" as const, text: prompt }],
									timestamp: Date.now(),
								},
							],
						},
						{
							apiKey: auth.apiKey,
							headers: auth.headers,
							signal: loader.signal,
						},
					);

					const text = response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");

					done(text || "(empty summary)");
				} catch {
					done(null);
				}
			})();

			return loader;
		});

		if (!summary) return;

		// Display the summary in a markdown viewer
		await ctx.ui.custom((_tui, theme, _kb, done) => {
			const container = new Container();
			const mdTheme = getMarkdownTheme();

			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(
				new Text(
					theme.fg(
						"accent",
						theme.bold(
							allChanges
								? `  📊 Summary of All Plan Changes (${iterations.length} iterations)`
								: `  📊 Changes: v${iterations.length - 1} → v${iterations.length}`,
						),
					),
					0,
					0,
				),
			);
			container.addChild(new Markdown(summary, 1, 1, mdTheme));
			container.addChild(new Text(theme.fg("dim", "  Press Enter or Esc to close"), 0, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w: number) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data: string) => {
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) done(undefined);
				},
			};
		});
	}

	// ─── Q&A History UI ─────────────────────────────────────

	async function showQAUI(ctx: ExtensionContext): Promise<void> {
		if (qaMessages.length === 0) {
			ctx.ui.notify("No Q&A history available.", "info");
			return;
		}

		// Build markdown from Q&A messages
		const mdContent = qaMessages
			.map((msg) => {
				const header = msg.role === "assistant" ? "### 🤖 Agent" : "### 👤 You";
				return `${header}\n\n${msg.content}`;
			})
			.join("\n\n---\n\n");

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const cleanupMouse = enableMouseWheel(tui);
			const finish = () => {
				cleanupMouse();
				done(undefined);
			};
			const mdTheme = getMarkdownTheme();
			const md = new Markdown(mdContent, 1, 0, mdTheme);
			let scrollOffset = 0;
			let cachedMdLines: string[] | null = null;
			let cachedWidth: number | null = null;

			return {
				render(width: number): string[] {
					if (!cachedMdLines || cachedWidth !== width) {
						cachedMdLines = md.render(width);
						cachedWidth = width;
					}

					const termHeight = process.stdout.rows || 24;
					const headerFooterLines = 7;
					const viewportHeight = Math.max(5, termHeight - headerFooterLines);
					const maxScroll = Math.max(0, cachedMdLines.length - viewportHeight);
					if (scrollOffset > maxScroll) scrollOffset = maxScroll;

					const lines: string[] = [];

					// ── Header ──
					lines.push(theme.fg("accent", "─".repeat(width)));
					lines.push(
						truncateToWidth(
							`  ${theme.fg("accent", theme.bold("💬 Q&A History"))}` +
								`  ${theme.fg("muted", `${qaMessages.length} message${qaMessages.length !== 1 ? "s" : ""}`)}` +
								(planTitle ? `  ${theme.fg("dim", planTitle)}` : ""),
							width,
						),
					);
					lines.push(theme.fg("accent", "─".repeat(width)));

					// ── Scrollable content ──
					const visible = cachedMdLines.slice(scrollOffset, scrollOffset + viewportHeight);
					lines.push(...visible);

					for (let i = visible.length; i < viewportHeight; i++) {
						lines.push("");
					}

					// ── Scroll indicator ──
					if (cachedMdLines.length > viewportHeight) {
						const pct = maxScroll > 0 ? Math.round((scrollOffset / maxScroll) * 100) : 100;
						lines.push(
							theme.fg("dim", `  ─── ${pct}% (${cachedMdLines.length} lines) ───`),
						);
					}

					// ── Footer ──
					lines.push(
						truncateToWidth(
							`  ${theme.fg("dim", "↑↓/j/k scroll  PgUp/PgDn page  mouse wheel scroll  Enter/Esc close")}`,
							width,
						),
					);
					lines.push(theme.fg("accent", "─".repeat(width)));

					return lines;
				},

				invalidate() {
					cachedMdLines = null;
					cachedWidth = null;
				},

				handleInput(data: string) {
					const termHeight = process.stdout.rows || 24;
					const viewportHeight = Math.max(5, termHeight - 7);
					const maxScroll = cachedMdLines ? Math.max(0, cachedMdLines.length - viewportHeight) : 0;
					const wheelDelta = getMouseWheelDelta(data);

					if (wheelDelta !== null) {
						scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + wheelDelta * 3));
						tui.requestRender();
						return;
					}

					if (matchesKey(data, Key.up) || data === "k") {
						scrollOffset = Math.max(0, scrollOffset - 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.down) || data === "j") {
						scrollOffset = Math.min(maxScroll, scrollOffset + 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.pageUp)) {
						scrollOffset = Math.max(0, scrollOffset - viewportHeight);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.pageDown)) {
						scrollOffset = Math.min(maxScroll, scrollOffset + viewportHeight);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "enter") || matchesKey(data, "escape")) {
						finish();
						return;
					}
				},
			};
		});
	}

	// ─── Plan Review UI (scrollable markdown) ───────────────

	async function showPlanReview(ctx: ExtensionContext, plan: string, iteration: number): Promise<ReviewAction> {
		return ctx.ui.custom<ReviewAction>((tui, theme, _kb, done) => {
			const cleanupMouse = enableMouseWheel(tui);
			const finish = (action: ReviewAction) => {
				cleanupMouse();
				done(action);
			};
			const mdTheme = getMarkdownTheme();
			const md = new Markdown(plan, 1, 0, mdTheme);
			let scrollOffset = 0;
			let cachedMdLines: string[] | null = null;
			let cachedWidth: number | null = null;

			return {
				render(width: number): string[] {
					// Render full markdown (cached until width changes)
					if (!cachedMdLines || cachedWidth !== width) {
						cachedMdLines = md.render(width);
						cachedWidth = width;
					}

					const termHeight = process.stdout.rows || 24;
					const headerFooterLines = 8;
					const viewportHeight = Math.max(5, termHeight - headerFooterLines);
					const maxScroll = Math.max(0, cachedMdLines.length - viewportHeight);
					if (scrollOffset > maxScroll) scrollOffset = maxScroll;

					const lines: string[] = [];

					// ── Header ──
					lines.push(theme.fg("accent", "─".repeat(width)));
					lines.push(
						truncateToWidth(
							`  ${theme.fg("accent", theme.bold("📋 Plan Review"))}` +
								`  ${theme.fg("muted", `Iteration ${iteration}`)}` +
								(planTitle ? `  ${theme.fg("dim", planTitle)}` : ""),
							width,
						),
					);
					lines.push(theme.fg("accent", "─".repeat(width)));

					// ── Scrollable plan content ──
					const visible = cachedMdLines.slice(scrollOffset, scrollOffset + viewportHeight);
					lines.push(...visible);

					// pad if content is shorter than viewport
					for (let i = visible.length; i < viewportHeight; i++) {
						lines.push("");
					}

					// ── Scroll indicator ──
					if (cachedMdLines.length > viewportHeight) {
						const pct = maxScroll > 0 ? Math.round((scrollOffset / maxScroll) * 100) : 100;
						lines.push(
							theme.fg("dim", `  ─── ${pct}% (${cachedMdLines.length} lines) ───`),
						);
					}

					// ── Footer actions ──
					lines.push("");
					const actions: string[] = [
						`${theme.fg("success", "a")} approve`,
						`${theme.fg("warning", "r")} revise`,
					];
					if (iteration > 1) {
						actions.push(
							`${theme.fg("accent", "d")} diff`,
							`${theme.fg("accent", "s")} summary`,
							`${theme.fg("accent", "S")} all changes`,
						);
					}
					actions.push(`${theme.fg("accent", "q")} Q&A`);
					actions.push(`${theme.fg("dim", "esc")} back`);
					lines.push(truncateToWidth(`  ${actions.join("  │  ")}`, width));
					lines.push(
						truncateToWidth(`  ${theme.fg("dim", "↑↓/j/k scroll  PgUp/PgDn page  mouse wheel scroll")}`, width),
					);
					lines.push(theme.fg("accent", "─".repeat(width)));

					return lines;
				},

				invalidate() {
					cachedMdLines = null;
					cachedWidth = null;
				},

				handleInput(data: string) {
					const termHeight = process.stdout.rows || 24;
					const viewportHeight = Math.max(5, termHeight - 8);
					const maxScroll = cachedMdLines ? Math.max(0, cachedMdLines.length - viewportHeight) : 0;
					const wheelDelta = getMouseWheelDelta(data);

					// ── Scrolling ──
					if (wheelDelta !== null) {
						scrollOffset = Math.max(0, Math.min(maxScroll, scrollOffset + wheelDelta * 3));
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.up) || data === "k") {
						scrollOffset = Math.max(0, scrollOffset - 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.down) || data === "j") {
						scrollOffset = Math.min(maxScroll, scrollOffset + 1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.pageUp)) {
						scrollOffset = Math.max(0, scrollOffset - viewportHeight);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.pageDown)) {
						scrollOffset = Math.min(maxScroll, scrollOffset + viewportHeight);
						tui.requestRender();
						return;
					}

					// ── Actions ──
					if (data === "a") {
						finish("approve");
						return;
					}
					if (data === "r") {
						finish("revise");
						return;
					}
					if (matchesKey(data, Key.escape)) {
						finish("cancel");
						return;
					}
					if (data === "d" && iteration > 1) {
						finish("diff");
						return;
					}
					if (data === "s" && iteration > 1) {
						finish("summary");
						return;
					}
					if (data === "S" && iteration > 1) {
						finish("allSummary");
						return;
					}
					if (data === "q") {
						finish("qa");
						return;
					}
				},
			};
		});
	}

	// ─── Plan Review Loop ───────────────────────────────────

	async function planReviewLoop(
		ctx: ExtensionContext,
		plan: string,
		iteration: number,
	): Promise<{ action: "approve" } | { action: "revise"; feedback: string } | { action: "cancel" }> {
		while (true) {
			const action = await showPlanReview(ctx, plan, iteration);

			switch (action) {
				case "approve":
					return { action: "approve" };

				case "cancel":
					return { action: "cancel" };

				case "revise": {
					const feedback = await ctx.ui.editor("What changes would you like to the plan?", "");
					if (feedback?.trim()) {
						return { action: "revise", feedback: feedback.trim() };
					}
					// empty / cancelled → back to review
					continue;
				}

				case "diff":
					await showDiffUI(ctx);
					continue;

				case "summary":
					await showSummaryUI(ctx, false);
					continue;

				case "allSummary":
					await showSummaryUI(ctx, true);
					continue;

				case "qa":
					await showQAUI(ctx);
					continue;
			}
		}
	}

	// ─── plan_output Tool ───────────────────────────────────

	pi.registerTool({
		name: "plan_output",
		label: "Plan Output",
		description:
			"Present a plan to the user for interactive review. " +
			"Use this ONLY after you have asked enough clarifying questions and are ready " +
			"to present a comprehensive plan. The plan must be in markdown format.",
		promptSnippet: "Present a markdown plan to the user for interactive review and approval",
		promptGuidelines: [
			"ALWAYS ask clarifying questions before calling plan_output. Never assume requirements.",
			"Only call plan_output when you have enough information to write a complete plan.",
			"If the user requests revisions, update the plan and call plan_output again.",
		],
		parameters: Type.Object({
			title: Type.String({ description: "Short descriptive title for the plan" }),
			plan: Type.String({
				description:
					"Full plan in markdown. Use headings, numbered steps, code blocks, and clear structure.",
			}),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: plan review requires interactive mode." }],
					details: {},
				};
			}
			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Plan review cancelled." }],
					details: {},
				};
			}

			// First iteration → create the plan git repo
			if (!planDir) {
				const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				const slug = generateSlug(params.title);
				planDir = join(PLANS_BASE, `${ts}_${slug}`);
				planTitle = params.title;

				try {
					await initPlanRepo(planDir);
				} catch (err) {
					return {
						content: [{ type: "text", text: `Error creating plan repo: ${err}` }],
						details: {},
					};
				}
			}

			// Save this iteration
			const iteration = iterations.length + 1;
			iterations.push(params.plan);

			try {
				await savePlanAndCommit(planDir, params.plan, iteration);
			} catch (err) {
				return {
					content: [{ type: "text", text: `Error committing plan: ${err}` }],
					details: {},
				};
			}

			persistState();
			updateUI(ctx);

			// Interactive review loop
			const result = await planReviewLoop(ctx, params.plan, iteration);

			switch (result.action) {
				case "approve":
					exitPlanMode(ctx, true);
					return {
						content: [
							{
								type: "text",
								text:
									"✅ Plan approved by the user.\n" +
									"Execute the approved plan step by step. Here is the plan:\n\n" +
									params.plan,
							},
						],
						details: { approved: true, iteration, planDir },
					};

				case "revise":
					return {
						content: [
							{
								type: "text",
								text:
									`The user wants changes to the plan.\n\nUser feedback:\n${result.feedback}\n\n` +
									"Update the plan based on this feedback and present the revised version by calling plan_output again.",
							},
						],
						details: { revised: true, feedback: result.feedback, iteration },
					};

				case "cancel":
					return {
						content: [
							{
								type: "text",
								text:
									"The user closed the plan review without approving or requesting revisions. " +
									"Continue the conversation — ask if they want to discuss further or have additional questions.",
							},
						],
						details: { cancelled: true, iteration },
					};
			}
		},

		// ── Custom rendering in the message stream ──

		renderCall(args, theme, _context) {
			const title = (args as { title?: string }).title || "Untitled";
			let text = theme.fg("toolTitle", theme.bold("plan_output "));
			text += theme.fg("muted", truncateToWidth(title, 60));
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as
				| { approved?: boolean; revised?: boolean; cancelled?: boolean; iteration?: number }
				| undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? truncateToWidth(first.text, 80) : "", 0, 0);
			}
			if (details.approved) {
				return new Text(theme.fg("success", `✅ Plan approved (iteration ${details.iteration})`), 0, 0);
			}
			if (details.revised) {
				return new Text(theme.fg("warning", `✏️  Revision requested (iteration ${details.iteration})`), 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("dim", `⏸  Review closed (iteration ${details.iteration})`), 0, 0);
			}
			return new Text(theme.fg("muted", "Plan presented"), 0, 0);
		},
	});

	// ─── Commands ───────────────────────────────────────────

	pi.registerFlag("plan", {
		description: "Start in plan mode",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("plan", {
		description: "Toggle plan mode (guided planning with clarifying questions)",
		handler: async (_args, ctx) => {
			if (active) {
				exitPlanMode(ctx);
			} else {
				enterPlanMode(ctx);
			}
		},
	});

	// ─── Keyboard Shortcuts ─────────────────────────────────

	pi.registerShortcut(Key.alt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			if (active) {
				exitPlanMode(ctx);
			} else {
				enterPlanMode(ctx);
			}
		},
	});

	pi.registerShortcut(Key.ctrlAlt("d"), {
		description: "Show plan diff (plan mode only)",
		handler: async (ctx) => {
			if (!active) return;
			await showDiffUI(ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("s"), {
		description: "Show plan change summary (plan mode only)",
		handler: async (ctx) => {
			if (!active) return;
			await showSummaryUI(ctx, false);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("a"), {
		description: "Show summary of all plan changes (plan mode only)",
		handler: async (ctx) => {
			if (!active) return;
			await showSummaryUI(ctx, true);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("q"), {
		description: "Show plan Q&A history",
		handler: async (ctx) => {
			if (qaMessages.length === 0) {
				ctx.ui.notify("No Q&A history available.", "info");
				return;
			}
			await showQAUI(ctx);
		},
	});

	// ─── Event: Capture Q&A messages ────────────────────────

	pi.on("message_end", async (event) => {
		if (!active) return;
		const msg = event.message as {
			role?: string;
			content?: Array<{ type: string; text?: string; name?: string }>;
		};

		// Skip assistant messages that contain a plan_output tool call
		if (msg.role === "assistant") {
			const hasToolUse = (msg.content ?? []).some(
				(c) => c.type === "tool_use" && c.name === "plan_output",
			);
			if (hasToolUse) return;
		}

		if (msg.role === "user" || msg.role === "assistant") {
			const text = (msg.content ?? [])
				.filter((c) => c.type === "text")
				.map((c) => c.text ?? "")
				.join("\n");
			if (text.trim()) {
				qaMessages.push({ role: msg.role as "user" | "assistant", content: text });
				persistState();
			}
		}
	});

	// ─── Event: Inject plan-mode system prompt ──────────────

	pi.on("before_agent_start", async (event) => {
		if (!active) return;

		return {
			systemPrompt: event.systemPrompt + "\n\n" + PLAN_MODE_SYSTEM_PROMPT,
			message: {
				customType: "plan-mode-context",
				content:
					"[PLAN MODE] I will ask clarifying questions before creating a plan. " +
					"I should wait for approval before executing changes.",
				display: false,
			},
		};
	});

	// ─── Event: Filter stale plan-mode context ──────────────

	pi.on("context", async (event) => {
		if (active) return; // keep context while planning

		return {
			messages: event.messages.filter((m) => {
				const msg = m as { customType?: string; role?: string; content?: unknown };
				// Drop injected plan-mode context messages
				if (msg.customType === "plan-mode-context") return false;
				return true;
			}),
		};
	});

	// ─── Event: Restore state on session start/resume ───────

	pi.on("session_start", async (_event, ctx) => {
		// Check --plan flag
		if (pi.getFlag("plan") === true) {
			enterPlanMode(ctx);
			return;
		}

		// Restore from persisted state
		const entries = ctx.sessionManager.getEntries();
		const stateEntry = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "plan-mode-interactive",
			)
			.pop() as
			| {
					data?: {
						active?: boolean;
						planDir?: string | null;
						iterations?: string[];
						planTitle?: string | null;
						qaMessages?: Array<{ role: "user" | "assistant"; content: string }>;
					};
			  }
			| undefined;

		if (stateEntry?.data) {
			active = stateEntry.data.active ?? false;
			planDir = stateEntry.data.planDir ?? null;
			iterations = stateEntry.data.iterations ?? [];
			planTitle = stateEntry.data.planTitle ?? null;
			qaMessages = stateEntry.data.qaMessages ?? [];
		}

		updateUI(ctx);
	});
}
