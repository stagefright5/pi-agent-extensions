import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import statusBar from "./index.ts";

function fixture(fast?: string) {
	let start: (_event: unknown, ctx: unknown) => void;
	let footer: { render(width: number): string[] };
	const statuses = new Map([["plan", "plan review"]]);
	if (fast) statuses.set("fast", fast);
	statusBar({
		on(name: string, handler: typeof start) {
			if (name === "session_start") start = handler;
		},
		getThinkingLevel: () => "high",
	} as never);
	const theme = { fg: (_token: string, text: string) => text };
	const ctx = {
		mode: "tui",
		model: { provider: "openai", name: "GPT-6 Astra", reasoning: true },
		thinkingLevel: "high",
		getContextUsage: () => ({ percent: 71.5, contextWindow: 272000 }),
		sessionManager: {
			getCwd: () => "/project",
			getEntries: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 16.991 } } } }],
		},
		ui: {
			theme,
			setFooter(factory: Function) {
				footer = factory({ requestRender() {} }, theme, {
					onBranchChange: () => () => {},
					getGitBranch: () => "main",
					getExtensionStatuses: () => statuses,
				});
			},
		},
	};
	start!(undefined, ctx);
	return { render: (width = 160) => footer!.render(width)[0]!, statuses };
}

test("fast icon follows effort exactly once, before context and cost", () => {
	// Accept the old status text as well as the new glyph; the stable key carries state.
	for (const value of ["fast", "⚡︎"]) {
		const { render } = fixture(value);
		const line = render();
		assert.ok(line.endsWith("openai/GPT-6 Astra · high · ⚡︎ · 71.5%/272k · $16.991"));
		assert.equal(line.split("⚡︎").length - 1, 1);
		assert.match(line, /plan review/);
		assert.doesNotMatch(line, /\bfast\b/);
	}
});

test("fast icon disappears immediately when the status is cleared", () => {
	const { render, statuses } = fixture("⚡︎");
	statuses.delete("fast");
	assert.ok(render().endsWith("openai/GPT-6 Astra · high · 71.5%/272k · $16.991"));
	assert.doesNotMatch(render(), /⚡/);
});

test("fast marker stays attached to effort at compact widths without overflow", () => {
	const { render } = fixture("⚡︎");
	for (const width of [1, 2, 40, 60, 80, 120, 160]) {
		const line = render(width);
		assert.ok(visibleWidth(line) <= width);
		if (line.includes("⚡︎")) assert.match(line, /high · ⚡︎/);
	}
});
