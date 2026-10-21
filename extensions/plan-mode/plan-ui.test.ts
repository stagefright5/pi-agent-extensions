import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { createPlanMessageComponent, requestRevision, showDocument, type ReviewAction } from "./plan-ui.ts";

// The document viewer itself (scrolling, selection, copy, footer clicks) is tested in pi-dialog.

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
initTheme("dark", false);
const dark: Theme = getThemeByName("dark");
const document = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} · 世界 é 🧊\n`).join("\n");

function context(rows = 40) {
	const state: { component?: Component & { dispose?(): void } } = {};
	const tui = { terminal: { rows, columns: 100 }, requestRender() {} };
	const ctx = {
		mode: "tui",
		ui: {
			theme: dark,
			notify() {},
			custom: (factory: any) =>
				new Promise((resolve) => {
					const component = factory(tui, dark, new KeybindingsManager(), (value: unknown) => {
						component.dispose?.();
						resolve(value);
					});
					state.component = component;
				}),
		},
	} as unknown as ExtensionContext;
	return { ctx, state };
}

test("inline plans obey width, including one-cell terminals", () => {
	for (const width of [0, 1, 2, 3, 10, 40, 80, 160]) {
		const inline = createPlanMessageComponent(document, "世界 title", 1, "/tmp/plan.md", dark);
		for (const line of inline.render(width)) assert.ok(visibleWidth(line) <= width);
	}
});

test("plan review opens as a framed popup with the plan actions and resolves the chosen action", async () => {
	const { ctx, state } = context();
	const lifetime = new AbortController();
	const result = showDocument(
		ctx,
		{
			kind: "Plan review",
			title: "Plan 世界",
			meta: "iteration 2",
			subtitle: "/tmp/plan.md",
			content: "# Heading\n\nBody text",
			actions: [
				{ key: "a", label: "approve", value: "approve", primary: true },
				{ key: "shift+s", label: "all changes", value: "allSummary" },
			],
		},
		lifetime.signal,
	);
	const lines = state.component!.render(80).map(stripTerminalSequences);
	assert.match(lines[0]!, /^╭─ ◆ Plan review {2}Plan 世界 ─+ iteration 2 ─╮/u);
	assert.match(lines.join("\n"), /a approve {4}⇧S all changes +c copy {3}esc close/u);
	state.component!.handleInput?.("S");
	assert.equal(await result, "allSummary" satisfies ReviewAction);

	const cancelled = showDocument(ctx, { title: "x", content: "y" }, lifetime.signal);
	lifetime.abort();
	assert.equal(await cancelled, "cancel");
	assert.equal(await showDocument(ctx, { title: "x", content: "y" }, lifetime.signal), "cancel");
});

test("the revision editor submits on Enter inside its popup", async () => {
	const { ctx, state } = context();
	const feedback = requestRevision(ctx, new AbortController().signal);
	const shown = state.component!.render(80).map(stripTerminalSequences).join("\n");
	assert.match(shown, /Revise plan/u);
	assert.match(shown, /What changes would you like to the plan\?/u);
	for (const key of "tighter") state.component!.handleInput?.(key);
	state.component!.handleInput?.("\r");
	assert.equal(await feedback, "tighter");
});
