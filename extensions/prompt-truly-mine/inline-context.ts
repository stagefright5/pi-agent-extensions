export const INLINE_COMPLETION_PREFIX_MARKER = "\u{e000}";
export const INLINE_CONTEXT_BUNDLE_MARKER = "pi-extension:inline-context:v1";

export type InlineCommandSource = "extension" | "skill" | "prompt";
export type ComposableCommandSource = Exclude<InlineCommandSource, "extension">;

export type InlineCommand = {
	name: string;
	description?: string;
	source: InlineCommandSource;
	path: string;
};

export type ComposableCommand = InlineCommand & {
	source: ComposableCommandSource;
};

export type ExtensionCommand = InlineCommand & {
	source: "extension";
};

export type PromotedExtensionCommand = {
	command: ExtensionCommand;
	text: string;
};

export type ContextCompletionItem = {
	value: string;
	label: string;
	description: string;
};

export type CompletionLeader = "/" | "$";

export type SlashCompletionContext = {
	prefix: string;
	query: string;
	tokenStart: number;
	isInitialCommand: boolean;
};

export type CompletionContext = SlashCompletionContext & { leader: CompletionLeader };

/** `$name` references: skills by bare name, prompt templates by name. Skills win clashes. */
export type ReferenceIndex = {
	byName: Map<string, ComposableCommand>;
	/** Names that are both a skill and a prompt template. */
	shadowed: Set<string>;
};

export type LoadedContextResource = ComposableCommand & {
	baseDir: string;
};

export type CompletionResult = {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
};

// Consume the whole token so /ask/file is not mistaken for the /ask command.
const COMMAND_TOKEN_PATTERN = /(^|[\s([{])\/([^\s]+)/g;
// `$name` references; `$` inside a word (prices, `a$b`) never starts one.
const REFERENCE_TOKEN_PATTERN = /(^|[\s([{])\$([^\s$]+)/g;

export const REFERENCE_LEADER = "$";

export function findSlashCompletionContext(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): SlashCompletionContext | null {
	const currentLine = lines[cursorLine] ?? "";
	const textBeforeCursor = currentLine.slice(0, cursorCol);
	const match = textBeforeCursor.match(/(?:^|[ \t])\/([^\s/]*)$/);
	if (!match) return null;

	const query = match[1] ?? "";
	const prefix = `/${query}`;
	const tokenStart = textBeforeCursor.length - prefix.length;
	const beforeTokenIsEmpty = currentLine.slice(0, tokenStart).trim().length === 0;

	return {
		prefix,
		query,
		tokenStart,
		isInitialCommand: cursorLine === 0 && beforeTokenIsEmpty,
	};
}

/** A `$name` reference being typed anywhere, or an inline `/command`. */
export function findCompletionContext(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): CompletionContext | null {
	const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
	const reference = textBeforeCursor.match(/(?:^|[\s([{])\$([^\s$]*)$/u);
	if (reference) {
		const query = reference[1] ?? "";
		const prefix = `$${query}`;
		return {
			leader: "$",
			prefix,
			query,
			tokenStart: textBeforeCursor.length - prefix.length,
			isInitialCommand: false,
		};
	}
	const slash = findSlashCompletionContext(lines, cursorLine, cursorCol);
	return slash ? { ...slash, leader: "/" } : null;
}

export function referenceName(command: ComposableCommand): string {
	return command.source === "skill" ? command.name.replace(/^skill:/u, "") : command.name;
}

export function buildReferenceIndex(commands: readonly ComposableCommand[]): ReferenceIndex {
	const byName = new Map<string, ComposableCommand>();
	const shadowed = new Set<string>();
	// Skills first so they win; a later template with the same name only marks the clash.
	const ordered = [...commands].sort((a, b) => Number(a.source !== "skill") - Number(b.source !== "skill"));
	for (const command of ordered) {
		const name = referenceName(command);
		const existing = byName.get(name);
		if (!existing) byName.set(name, command);
		else if (existing.source !== command.source) shadowed.add(name);
	}
	return { byName, shadowed };
}

/** The encoded prefix keeps Pi from treating an inline `/` or `$` completion as a leading command. */
export function encodeComposableCompletionPrefix(prefix: string): string {
	return `${INLINE_COMPLETION_PREFIX_MARKER}${prefix}`;
}

export function decodeComposableCompletionPrefix(prefix: string): string | null {
	if (!prefix.startsWith(INLINE_COMPLETION_PREFIX_MARKER)) return null;
	return prefix.slice(INLINE_COMPLETION_PREFIX_MARKER.length);
}

export function applyComposableCompletion(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
	itemValue: string,
	encodedPrefix: string,
): CompletionResult {
	const prefix = decodeComposableCompletionPrefix(encodedPrefix);
	if (prefix === null) {
		return { lines, cursorLine, cursorCol };
	}

	const currentLine = lines[cursorLine] ?? "";
	const beforePrefix = currentLine.slice(0, Math.max(0, cursorCol - prefix.length));
	const afterCursor = currentLine.slice(cursorCol);
	const leader = prefix[0] ?? "/";
	const value = itemValue.startsWith(leader) ? itemValue : `${leader}${itemValue}`;
	const suffix = afterCursor.length === 0 || !/^\s/.test(afterCursor) ? " " : "";
	const nextLines = [...lines];
	nextLines[cursorLine] = `${beforePrefix}${value}${suffix}${afterCursor}`;

	return {
		lines: nextLines,
		cursorLine,
		cursorCol: beforePrefix.length + value.length + suffix.length,
	};
}

function fuzzyScore(value: string, query: string): number | null {
	const normalizedValue = value.toLowerCase();
	const normalizedQuery = query.toLowerCase();
	if (!normalizedQuery) return 0;
	if (normalizedValue === normalizedQuery) return 0;
	if (normalizedValue.startsWith(normalizedQuery)) return 10 + normalizedValue.length - normalizedQuery.length;

	const substringIndex = normalizedValue.indexOf(normalizedQuery);
	if (substringIndex >= 0) return 100 + substringIndex;

	let valueIndex = 0;
	let gapScore = 0;
	for (const character of normalizedQuery) {
		const matchIndex = normalizedValue.indexOf(character, valueIndex);
		if (matchIndex < 0) return null;
		gapScore += matchIndex - valueIndex;
		valueIndex = matchIndex + 1;
	}
	return 1000 + gapScore;
}

function ranked<T>(entries: readonly T[], name: (entry: T) => string, query: string): T[] {
	return entries
		.map((entry, index) => ({ entry, index, score: fuzzyScore(name(entry), query) }))
		.filter((candidate): candidate is { entry: T; index: number; score: number } => candidate.score !== null)
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.map(({ entry }) => entry);
}

/** Inline `/` completion: extension commands only (skills and templates use `$`). */
export function buildCommandCompletionItems(
	commands: readonly InlineCommand[],
	query: string,
): ContextCompletionItem[] {
	const extensions = [...new Map(commands.filter((c) => c.source === "extension").map((c) => [c.name, c])).values()];
	return ranked(extensions, (command) => command.name, query).map((command) => ({
		value: `/${command.name}`,
		label: command.name,
		description: `[extension]${command.description ? ` ${command.description}` : ""}`,
	}));
}

/** `$` completion: skills and prompt templates by reference name; clashes note that the skill wins. */
export function buildReferenceCompletionItems(index: ReferenceIndex, query: string): ContextCompletionItem[] {
	return ranked([...index.byName.entries()], ([name]) => name, query).map(([name, command]) => ({
		value: `$${name}`,
		label: name,
		description:
			`[${command.source}]${command.description ? ` ${command.description}` : ""}` +
			(index.shadowed.has(name) ? " · also a prompt template; the skill is used" : ""),
	}));
}

export function promoteInlineExtensionCommand(
	text: string,
	commands: readonly InlineCommand[],
): PromotedExtensionCommand | null {
	const byInvocation = new Map(
		commands
			.filter((command): command is ExtensionCommand => command.source === "extension")
			.map((command) => [command.name, command]),
	);

	for (const match of text.matchAll(COMMAND_TOKEN_PATTERN)) {
		const token = match[2];
		if (!token) continue;
		const invocation = byInvocation.has(token) ? token : token.replace(/[),.;!?\]}]+$/, "");
		const command = byInvocation.get(invocation);
		if (!command) continue;

		return {
			command,
			text: `/${command.name} ${text}`,
		};
	}

	return null;
}

/**
 * `$name` references to known skills and prompt templates, deduplicated, in first-use order.
 * Unknown names (`$HOME`, `$1`, prices) stay literal text. `shadowed` lists referenced names that
 * are both a skill and a template (the skill is used).
 */
export function extractReferences(
	text: string,
	index: ReferenceIndex,
): { resources: ComposableCommand[]; shadowed: string[] } {
	const selected = new Map<string, ComposableCommand>();
	const shadowed = new Set<string>();
	for (const match of text.matchAll(REFERENCE_TOKEN_PATTERN)) {
		const token = match[2];
		if (!token) continue;
		const name = index.byName.has(token) ? token : token.replace(/[),.;:!?\]}'"`]+$/u, "");
		const command = index.byName.get(name);
		if (!command) continue;
		if (index.shadowed.has(name)) shadowed.add(name);
		const key = `${command.source}\0${command.name}\0${command.path}`;
		if (!selected.has(key)) selected.set(key, command);
	}
	return { resources: [...selected.values()], shadowed: [...shadowed] };
}

/**
 * The old `/skill:name` and leading `/template` forms, which this extension blocks in favor of
 * `$name`. Returns the reference name to suggest, or null for anything else.
 */
export function findRetiredSlashReference(
	text: string,
	commands: readonly ComposableCommand[],
): { source: ComposableCommandSource; name: string } | null {
	const match = text.trimStart().match(/^\/(\S+)/u);
	if (!match) return null;
	const token = match[1]!;
	if (token.startsWith("skill:")) {
		const skill = commands.find((command) => command.source === "skill" && command.name === token);
		return skill ? { source: "skill", name: referenceName(skill) } : null;
	}
	const template = commands.find((command) => command.source === "prompt" && command.name === token);
	return template ? { source: "prompt", name: template.name } : null;
}

export const INLINE_CONTEXT_REFERENCES_MARKER = "pi-extension:inline-context:v2";

function describeReference(resource: LoadedContextResource): string {
	if (resource.source === "skill") {
		return `- Skill \`$${referenceName(resource)}\`: ${resource.path} (relative paths inside it resolve against ${resource.baseDir})`;
	}
	return `- Prompt template \`$${resource.name}\`: ${resource.path} (its $ARGUMENTS, $@, and $1, $2, \u2026 placeholders refer to the request above)`;
}

/**
 * Keep the user's request first and verbatim. Referenced skills and prompt templates follow as
 * file pointers, so the agent reads the request before loading each resource with its own tools.
 */
export function formatContextReferences(originalText: string, resources: readonly LoadedContextResource[]): string {
	if (resources.length === 0) return originalText;
	return [
		originalText,
		"",
		`<!-- ${INLINE_CONTEXT_REFERENCES_MARKER} -->`,
		"<context-references>",
		`The request above references ${resources.length === 1 ? "this resource" : "these resources"}. Read each file before acting on the request, then apply it to the request above.`,
		...resources.map(describeReference),
		"</context-references>",
	].join("\n");
}

/** True for text this extension already rewrote, including the older prepended bundle format. */
export function hasContextReferences(text: string): boolean {
	return (
		text.includes(`<!-- ${INLINE_CONTEXT_REFERENCES_MARKER} -->`) ||
		(text.startsWith("<skill ") && text.includes(`<!-- ${INLINE_CONTEXT_BUNDLE_MARKER} -->`))
	);
}
