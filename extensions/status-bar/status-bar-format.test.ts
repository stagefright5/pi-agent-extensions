import assert from "node:assert/strict";
import test from "node:test";
import { buildStatusBarParts, formatModelDisplayLabel } from "./status-bar-format.ts";

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
