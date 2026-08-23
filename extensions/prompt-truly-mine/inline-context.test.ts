import assert from "node:assert/strict";
import test from "node:test";
import {
	applyComposableCompletion,
	buildContextCompletionItems,
	encodeComposableCompletionPrefix,
	extractReferencedCommands,
	findSlashCompletionContext,
	formatContextBundle,
	isExpandedContextBundle,
	parseCommandArgs,
	promoteInlineExtensionCommand,
	substitutePromptArguments,
	type ComposableCommand,
	type InlineCommand,
	type LoadedContextResource,
} from "./inline-context.ts";

const commands: ComposableCommand[] = [
	{
		name: "review",
		description: "Review before deciding",
		source: "prompt",
		path: "/home/me/.pi/agent/prompts/review.md",
	},
	{
		name: "skill:angular-developer",
		description: "Angular architecture and implementation",
		source: "skill",
		path: "/home/me/.agents/skills/angular-developer/SKILL.md",
	},
	{
		name: "skill:terminal-browser",
		description: "Drive a terminal browser",
		source: "skill",
		path: "/home/me/.agents/skills/terminal-browser/SKILL.md",
	},
];

const inlineCommands: InlineCommand[] = [
	{
		name: "ask",
		description: "Ask before deciding",
		source: "extension",
		path: "/home/me/.pi/agent/extensions/ask/index.ts",
	},
	{
		name: "websearch",
		description: "Open web search curator",
		source: "extension",
		path: "/home/me/.pi/agent/npm/node_modules/pi-web-access/index.ts",
	},
	...commands,
];

test("distinguishes the initial slash menu from inline context completion", () => {
	assert.deepEqual(findSlashCompletionContext(["/ski"], 0, 4), {
		prefix: "/ski",
		query: "ski",
		tokenStart: 0,
		isInitialCommand: true,
	});
	assert.deepEqual(findSlashCompletionContext(["Implement with /ang"], 0, 19), {
		prefix: "/ang",
		query: "ang",
		tokenStart: 15,
		isInitialCommand: false,
	});
	assert.equal(findSlashCompletionContext(["", "/review"], 1, 7)?.isInitialCommand, false);
	assert.equal(findSlashCompletionContext(["Inspect .pi/agent/"], 0, 18), null);
	assert.equal(findSlashCompletionContext(["Open https://example.com/"], 0, 25), null);
});

test("applies an encoded completion without submitting or damaging surrounding text", () => {
	const prefix = encodeComposableCompletionPrefix("/ang");
	assert.deepEqual(applyComposableCompletion(["Use /ang"], 0, 8, "skill:angular-developer", prefix), {
		lines: ["Use /skill:angular-developer "],
		cursorLine: 0,
		cursorCol: 29,
	});

	assert.deepEqual(
		applyComposableCompletion(["Use /rev later"], 0, 8, "review", encodeComposableCompletionPrefix("/rev")),
		{
			lines: ["Use /review later"],
			cursorLine: 0,
			cursorCol: 11,
		},
	);
});

test("fuzzy-filters and labels extension, prompt, and skill completion items", () => {
	assert.deepEqual(buildContextCompletionItems(inlineCommands, "web"), [
		{
			value: "websearch",
			label: "websearch",
			description: "[extension] Open web search curator",
		},
	]);
	assert.deepEqual(buildContextCompletionItems(inlineCommands, "ang"), [
		{
			value: "skill:angular-developer",
			label: "skill:angular-developer",
			description: "[skill] Angular architecture and implementation",
		},
	]);
	assert.deepEqual(buildContextCompletionItems(inlineCommands, "ask"), [
		{
			value: "ask",
			label: "ask",
			description: "[extension] Ask before deciding",
		},
	]);
	assert.deepEqual(buildContextCompletionItems([...inlineCommands, commands[0]!], "review"), [
		{
			value: "review",
			label: "review",
			description: "[prompt] Review before deciding",
		},
	]);
});

test("promotes the first inline extension command and preserves the complete draft as arguments", () => {
	assert.deepEqual(promoteInlineExtensionCommand("hi please /ask test", inlineCommands), {
		command: inlineCommands[0],
		text: "/ask hi please /ask test",
	});
	assert.deepEqual(promoteInlineExtensionCommand("search /websearch react hooks", inlineCommands), {
		command: inlineCommands[1],
		text: "/websearch search /websearch react hooks",
	});
	assert.equal(promoteInlineExtensionCommand("Use /review and https://example.com/ask", inlineCommands), null);
});

test("extracts known references across punctuation boundaries and deduplicates bodies", () => {
	const text = "Build this with (/skill:terminal-browser), then /review; /review and /skill:angular-developer.";
	assert.deepEqual(
		extractReferencedCommands(text, commands).map((command) => command.name),
		["skill:terminal-browser", "review", "skill:angular-developer"],
	);
	assert.deepEqual(extractReferencedCommands("Open /unknown and https://example.com/review", commands), []);
});

test("parses quoted whole-draft arguments like Pi", () => {
	assert.deepEqual(parseCommandArgs(`Build "login form" 'with tests' /review`), [
		"Build",
		"login form",
		"with tests",
		"/review",
	]);
});

test("substitutes all Pi prompt-template placeholder forms without recursion", () => {
	const args = ["one", "two", "$1"];
	const template = [
		"$1|$2|$4",
		"$@|$ARGUMENTS",
		"${1:-fallback}|${4:-fallback}",
		"${@:-fallback}",
		"${@:2}|${@:2:1}|${@:0:2}",
	].join("\n");
	assert.equal(
		substitutePromptArguments(template, args),
		["one|two|", "one two $1|one two $1", "one|fallback", "one two $1", "two $1|two|one two"].join("\n"),
	);
	assert.equal(substitutePromptArguments("$1", ["$ARGUMENTS"]), "$ARGUMENTS");
});

test("formats a collapsible mixed bundle and preserves the original draft verbatim", () => {
	const original = `Implement "login form" with /skill:angular-developer /review`;
	const resources: LoadedContextResource[] = [
		{
			...commands[1]!,
			body: "# Angular\n\nUse standalone components.",
			baseDir: "/home/me/.agents/skills/angular-developer",
		},
		{
			...commands[0]!,
			body: "Review this complete request: $ARGUMENTS\nFirst token: $1",
			baseDir: "/home/me/.pi/agent/prompts",
		},
	];
	const formatted = formatContextBundle(original, resources);

	assert.match(formatted, /^<skill name="angular-developer, prompt:review" location="multiple">/);
	assert.match(formatted, /## Skill: angular-developer/);
	assert.match(formatted, /References are relative to \/home\/me\/\.agents\/skills\/angular-developer\./);
	assert.match(formatted, /## Prompt template: review/);
	assert.match(
		formatted,
		/Review this complete request: Implement login form with \/skill:angular-developer \/review/,
	);
	assert.match(formatted, /First token: Implement/);
	assert.ok(formatted.endsWith(`\n\n${original}`));
	assert.equal(isExpandedContextBundle(formatted), true);
	assert.equal((formatted.match(/# Angular/g) ?? []).length, 1);
});

test("returns untouched text when no resources are available", () => {
	assert.equal(formatContextBundle("Keep /unknown", []), "Keep /unknown");
	assert.equal(isExpandedContextBundle("Keep /unknown"), false);
});
