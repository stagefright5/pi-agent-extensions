import assert from "node:assert/strict";
import test from "node:test";
import {
	applyComposableCompletion,
	buildCommandCompletionItems,
	buildReferenceCompletionItems,
	buildReferenceIndex,
	encodeComposableCompletionPrefix,
	extractReferences,
	findCompletionContext,
	findRetiredSlashReference,
	findSlashCompletionContext,
	formatContextReferences,
	hasContextReferences,
	promoteInlineExtensionCommand,
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

test("$ opens reference completion anywhere; / keeps inline command completion", () => {
	assert.deepEqual(findCompletionContext(["$ang"], 0, 4), {
		leader: "$",
		prefix: "$ang",
		query: "ang",
		tokenStart: 0,
		isInitialCommand: false,
	});
	assert.equal(findCompletionContext(["Fix it with ($rev"], 0, 17)?.prefix, "$rev");
	assert.equal(findCompletionContext(["costs US$5"], 0, 10), null, "$ inside a word is literal");
	assert.equal(findCompletionContext(["Ask /as"], 0, 7)?.leader, "/");
	assert.equal(findCompletionContext(["/ski"], 0, 4)?.isInitialCommand, true);
});

test("applies an encoded completion without submitting or damaging surrounding text", () => {
	assert.deepEqual(
		applyComposableCompletion(["Use $ang"], 0, 8, "$angular-developer", encodeComposableCompletionPrefix("$ang")),
		{ lines: ["Use $angular-developer "], cursorLine: 0, cursorCol: 23 },
	);
	assert.deepEqual(
		applyComposableCompletion(["Use $rev later"], 0, 8, "$review", encodeComposableCompletionPrefix("$rev")),
		{ lines: ["Use $review later"], cursorLine: 0, cursorCol: 11 },
	);
	assert.deepEqual(applyComposableCompletion(["hi /as"], 0, 6, "/ask", encodeComposableCompletionPrefix("/as")), {
		lines: ["hi /ask "],
		cursorLine: 0,
		cursorCol: 8,
	});
});

test("inline / offers extension commands only; $ offers skills and templates by bare name", () => {
	assert.deepEqual(buildCommandCompletionItems(inlineCommands, "web"), [
		{ value: "/websearch", label: "websearch", description: "[extension] Open web search curator" },
	]);
	assert.deepEqual(buildCommandCompletionItems(inlineCommands, "ang"), [], "skills are not / items");
	const index = buildReferenceIndex(commands);
	assert.deepEqual(buildReferenceCompletionItems(index, "ang"), [
		{
			value: "$angular-developer",
			label: "angular-developer",
			description: "[skill] Angular architecture and implementation",
		},
	]);
	assert.deepEqual(buildReferenceCompletionItems(index, "review"), [
		{ value: "$review", label: "review", description: "[prompt] Review before deciding" },
	]);
	assert.deepEqual(buildReferenceCompletionItems(index, "ask"), [], "extension commands are not $ items");
});

test("skill and template name clashes: the skill wins and the clash is reported", () => {
	const clash: ComposableCommand[] = [
		{ name: "review", source: "prompt", path: "/p/review.md" },
		{ name: "skill:review", source: "skill", path: "/s/review/SKILL.md", description: "Review skill" },
	];
	const index = buildReferenceIndex(clash);
	assert.equal(index.byName.get("review")?.source, "skill");
	assert.deepEqual([...index.shadowed], ["review"]);
	assert.match(
		buildReferenceCompletionItems(index, "review")[0]!.description,
		/also a prompt template; the skill is used/u,
	);
	const found = extractReferences("Please $review this", index);
	assert.deepEqual(
		found.resources.map((command) => command.path),
		["/s/review/SKILL.md"],
	);
	assert.deepEqual(found.shadowed, ["review"]);
});

test("retired /skill:name and leading /template forms are detected for blocking", () => {
	assert.deepEqual(findRetiredSlashReference("/skill:angular-developer do it", commands), {
		source: "skill",
		name: "angular-developer",
	});
	assert.deepEqual(findRetiredSlashReference("  /review the diff", commands), { source: "prompt", name: "review" });
	assert.equal(findRetiredSlashReference("/skill:unknown x", commands), null);
	assert.equal(findRetiredSlashReference("please /review this", commands), null, "only a leading /template");
	assert.equal(findRetiredSlashReference("/settings", commands), null);
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

test("slash paths are not commands, and $ only references known names", () => {
	const index = buildReferenceIndex(commands);
	for (const text of ["Open /ask/file.ts", "Use /ask/"]) {
		assert.equal(promoteInlineExtensionCommand(text, inlineCommands), null);
	}
	for (const text of [
		"echo $HOME",
		"costs $5 or US$review",
		"$1 and ${ARGUMENTS}",
		"/review and /skill:angular-developer",
		"$review/src",
	]) {
		assert.deepEqual(extractReferences(text, index).resources, [], text);
	}
});

test("extracts $ references across punctuation boundaries and deduplicates", () => {
	const index = buildReferenceIndex(commands);
	const text = "Build this with ($terminal-browser), then $review; $review and $angular-developer.";
	assert.deepEqual(
		extractReferences(text, index).resources.map((command) => command.name),
		["skill:terminal-browser", "review", "skill:angular-developer"],
	);
});

test("keeps the request first and verbatim, then lists referenced resources as files to read", () => {
	const original = `Implement "login form" with $angular-developer $review`;
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
	const formatted = formatContextReferences(original, resources);

	assert.ok(formatted.startsWith(`${original}\n\n`), "the request comes first, unchanged");
	assert.match(formatted, /<!-- pi-extension:inline-context:v2 -->\n<context-references>\n/u);
	assert.match(formatted, /Read each file before acting on the request/u);
	assert.match(
		formatted,
		/- Skill `\$angular-developer`: \S+SKILL\.md \(relative paths inside it resolve against \/home\/me\/\.agents\/skills\/angular-developer\)/u,
	);
	assert.match(
		formatted,
		/- Prompt template `\$review`: \S+ \(its \$ARGUMENTS, \$@, and \$1, \$2, … placeholders refer to the request above\)/u,
	);
	assert.doesNotMatch(formatted, /Use standalone components|Review this complete request/u, "bodies are not inlined");
	assert.ok(formatted.endsWith("</context-references>"));
	assert.equal(hasContextReferences(formatted), true);
});

test("returns untouched text when no resources are available", () => {
	assert.equal(formatContextReferences("Keep /unknown", []), "Keep /unknown");
	assert.equal(hasContextReferences("Keep /unknown"), false);
	const legacy = '<skill name="x" location="y">\n<!-- pi-extension:inline-context:v1 -->\n</skill>\n\nTask';
	assert.equal(hasContextReferences(legacy), true, "older bundles are not rewritten again");
});
