import assert from "node:assert/strict";
import test from "node:test";
import { ASK_POLICY, buildAskPrompt, parseAskArguments } from "./ask-prompt.ts";

test("parses quoted command arguments like pi prompt templates", () => {
	assert.deepEqual(parseAskArguments(`Implement "login form" 'with tests'`), [
		"Implement",
		"login form",
		"with tests",
	]);
});

test("builds the ask policy followed by normalized command arguments", () => {
	const prompt = buildAskPrompt(`Implement "login form" 'with tests'`);
	assert.ok(prompt.startsWith("Do not guess and do not silently pick defaults."));
	assert.ok(prompt.includes("use it. Prefer it over prose every time."));
	assert.ok(prompt.endsWith("\n\nImplement login form with tests"));
});

test("preserves the current no-argument behavior", () => {
	assert.equal(buildAskPrompt(""), ASK_POLICY);
	assert.equal(buildAskPrompt("   "), ASK_POLICY);
});
