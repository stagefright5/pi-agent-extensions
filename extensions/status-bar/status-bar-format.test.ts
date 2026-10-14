import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { buildStatusBarParts, formatModelDisplayLabel, layoutStatusBar } from "./status-bar-format.ts";

test("formats the provider, model display name, and thinking level", () => {
	assert.equal(
		formatModelDisplayLabel({ provider: "anthropic", name: "Claude Sonnet 4.6" }, "high"),
		"anthropic/Claude Sonnet 4.6 (high)",
	);
	assert.equal(formatModelDisplayLabel({ provider: "openai", name: "GPT-4.1" }, undefined), "openai/GPT-4.1 (off)");
	assert.equal(formatModelDisplayLabel(undefined, "high"), undefined);
});

test("places the model after cost and before extension statuses", () => {
	assert.deepEqual(buildStatusBarParts("~", "28.5%/272k", "$0.957", "anthropic/Claude Sonnet 4.6 (high)", ["plan"]), [
		"~",
		"28.5%/272k",
		"$0.957",
		"anthropic/Claude Sonnet 4.6 (high)",
		"plan",
	]);
});

test("omits the model field when no model is selected", () => {
	assert.deepEqual(buildStatusBarParts("~", "?/0", "$0.000", undefined, []), ["~", "?/0", "$0.000"]);
});

const data = {
	location: "~/PersonalDev/世界/project · main",
	shortLocation: "project · main",
	model: "provider/model · high",
	shortModel: "model · high",
	context: "\x1b[31m95%/200k\x1b[39m",
	cost: "$0.031",
	statuses: ["plan · review"],
	separator: " · ",
};

test("wide footer balances both groups and preserves every field", () => {
	const line = stripVTControlCharacters(layoutStatusBar(data, 160));
	for (const part of [data.location, data.model, "95%/200k", data.cost, ...data.statuses])
		assert.ok(line.includes(part));
	assert.equal(visibleWidth(line), 160);
	assert.match(line, /review {3,}provider/);
});

test("narrow footer protects context and extension status before metadata", () => {
	const line = stripVTControlCharacters(layoutStatusBar(data, 40));
	assert.ok(line.startsWith("95%/200k · plan · review"));
	assert.ok(visibleWidth(line) <= 40);
	assert.ok(layoutStatusBar(data, 40).includes("\x1b[31m"));
});

test("footer handles tiny widths, ANSI, long paths, emoji and unknown context", () => {
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160]) {
		assert.ok(
			visibleWidth(
				layoutStatusBar(
					{ ...data, location: "世界é🧊".repeat(100), statuses: ["plan 世界é🧊".repeat(10)] },
					width,
				),
			) <= width,
		);
		assert.ok(
			visibleWidth(
				layoutStatusBar({ ...data, context: "?/200k", statuses: [], model: "", shortModel: "" }, width),
			) <= width,
		);
	}
});
