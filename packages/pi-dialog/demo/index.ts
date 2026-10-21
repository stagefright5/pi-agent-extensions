/**
 * Development gallery for visual QA (not published): `pi -e packages/pi-dialog/demo/index.ts`,
 * then `/dialog-demo`. Every variant opens in turn; the results are reported as notifications.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	alert,
	confirm,
	editor,
	input,
	openPopup,
	select,
	showDocument,
	withLoader,
	type PopupTone,
} from "../src/index.ts";

const DOCUMENT = `# Shared popups

Every extension in this workspace opens the **same framed card**: a rounded border in the tone
colour, the title and meta set into it, a tinted panel, footer chips, and a drop shadow.

\`\`\`ts
const ok = await confirm(ctx, { title: "Delete jobs?", message: "This cannot be undone.", tone: "danger" });
\`\`\`

${Array.from({ length: 30 }, (_, i) => `- Item ${i + 1}: scroll with ↑/↓, PgUp/PgDn, g/G, or the wheel`).join("\n")}
`;

async function gallery(ctx: ExtensionContext): Promise<void> {
	const report = (label: string, value: unknown) => ctx.ui.notify(`${label}: ${JSON.stringify(value)}`, "info");
	const which = await select(ctx, {
		title: "Dialog gallery",
		message: "Choose a variant to preview. Digits pick directly.",
		options: [
			{ value: "all", label: "Everything", description: "every variant in turn" },
			{ value: "confirm", label: "Confirm", description: "yes/no with a focus ring" },
			{ value: "danger", label: "Danger confirm", description: "safe button focused first" },
			{ value: "alert", label: "Alert", description: "one button, each tone" },
			{ value: "input", label: "Input", description: "validation inline" },
			{ value: "editor", label: "Editor", description: "Pi's multi-line editor" },
			{ value: "document", label: "Document", description: "markdown, actions, copy, selection" },
			{ value: "loader", label: "Loader", description: "spinner, Esc cancels" },
			{ value: "timeout", label: "Timeout", description: "closes itself after 5 s" },
			{ value: "custom", label: "Custom popup", description: "any component in the frame" },
			{ value: "disabled", label: "Disabled item", disabled: true },
		],
	});
	if (which === undefined) return;
	const run = (name: string) => which === "all" || which === name;
	if (run("confirm"))
		report("confirm", await confirm(ctx, { title: "Apply changes?", message: "Three files will be rewritten." }));
	if (run("danger"))
		report(
			"danger",
			await confirm(ctx, {
				title: "Delete 3 jobs?",
				message: "Their logs are removed as well. This cannot be undone.",
				tone: "danger",
				confirmLabel: "Delete",
				cancelLabel: "Keep",
			}),
		);
	if (run("alert"))
		for (const tone of ["info", "success", "warning", "danger"] as PopupTone[])
			await alert(ctx, { title: `${tone} alert`, message: `A ${tone} message with the ${tone} border.`, tone });
	if (run("input"))
		report(
			"input",
			await input(ctx, {
				title: "New branch",
				message: "Name the branch to create.",
				placeholder: "feature/…",
				validate: (value) => (/\s/u.test(value) ? "Branch names cannot contain spaces" : undefined),
			}),
		);
	if (run("editor"))
		report("editor", await editor(ctx, { title: "Revise plan", message: "What should change?", prefill: "Draft" }));
	if (run("document"))
		report(
			"document",
			await showDocument(ctx, {
				kind: "Preview",
				title: "Shared popups",
				meta: "demo",
				subtitle: process.cwd(),
				content: DOCUMENT,
				actions: [
					{ key: "a", label: "approve", value: "approve", primary: true },
					{ key: "r", label: "revise", value: "revise" },
				],
			}),
		);
	if (run("loader"))
		report(
			"loader",
			await withLoader(
				ctx,
				"Pretending to work for 3 seconds…",
				new AbortController().signal,
				(signal) =>
					new Promise<string>((resolve, reject) => {
						const timer = setTimeout(() => resolve("finished"), 3000);
						signal.addEventListener("abort", () => {
							clearTimeout(timer);
							reject(signal.reason);
						});
					}),
			),
		);
	if (run("timeout"))
		report(
			"timeout",
			await confirm(ctx, {
				title: "Still there?",
				message: "This closes by itself.",
				tone: "warning",
				timeout: 5000,
			}),
		);
	if (run("custom"))
		await openPopup<void>(
			ctx,
			(api) => ({
				render: (width) => [
					"",
					api.theme().fg("accent", "Any component fits in the frame."),
					api.theme().fg("dim", `Body width ${width}; press Esc.`),
					"",
				],
				invalidate() {},
				handleInput: (data) => {
					if (data === "\x1b") api.close();
				},
			}),
			{ title: "Custom body", icon: "◇", meta: "esc closes", height: { fit: true }, overlay: { width: 50 } },
		);
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("dialog-demo", {
		description: "Preview pi-dialog popups (development gallery)",
		handler: async (_args, ctx) => gallery(ctx),
	});
}
