import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import statusBar from "./index.ts";
import { statusLineChannel } from "./status-line.ts";

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
			getSessionId: () => "test",
			getLeafId: () => "leaf",
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
	return {
		render: (width = 160) => footer!.render(width)[0]!,
		rows: (width = 160) => footer!.render(width),
		dispose: () => (footer as { dispose?: () => void }).dispose?.(),
		statuses,
	};
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

test("lends its line to a focused host editor and steps aside; falls back the moment it stops", () => {
	const { rows, dispose } = fixture();
	const channel = statusLineChannel();
	let hosting = true;
	channel.host = { hostsStatusLine: () => hosting };
	try {
		assert.deepEqual(rows(), [], "the editor draws the line; the footer row disappears");
		const lent = channel.render!(120, "⌃Z undo  ⌃Y redo");
		assert.equal(visibleWidth(lent), 120);
		assert.match(lent, /^\/project · main · plan review +⌃Z undo {2}⌃Y redo +openai\/GPT-6 Astra/u);
		assert.doesNotMatch(channel.render!(70, "⌃Z undo  ⌃Y redo"), /undo/, "the centre is dropped first");
		hosting = false;
		assert.equal(rows().length, 1, "picker or overlay focused: the status bar shows again");
		dispose();
		assert.equal(channel.render, undefined, "disposing the footer withdraws the line");
	} finally {
		channel.host = undefined;
	}
});
