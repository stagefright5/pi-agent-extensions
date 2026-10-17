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

export type SlashCompletionContext = {
	prefix: string;
	query: string;
	tokenStart: number;
	isInitialCommand: boolean;
};

export type LoadedContextResource = ComposableCommand & {
	body: string;
	baseDir: string;
};

export type CompletionResult = {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
};

// Consume the whole token so /review/file is not mistaken for the /review tag.
const RESOURCE_TOKEN_PATTERN = /(^|[\s([{])\/([^\s]+)/g;

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

export function encodeComposableCompletionPrefix(prefix: string): string {
	return prefix.startsWith("/") ? `${INLINE_COMPLETION_PREFIX_MARKER}${prefix.slice(1)}` : prefix;
}

export function decodeComposableCompletionPrefix(prefix: string): string | null {
	if (!prefix.startsWith(INLINE_COMPLETION_PREFIX_MARKER)) return null;
	return `/${prefix.slice(INLINE_COMPLETION_PREFIX_MARKER.length)}`;
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
	const value = itemValue.startsWith("/") ? itemValue : `/${itemValue}`;
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

export function buildContextCompletionItems(
	commands: readonly InlineCommand[],
	query: string,
): ContextCompletionItem[] {
	const unique = new Map<string, { command: InlineCommand; index: number; score: number }>();
	commands.forEach((command, index) => {
		const score = fuzzyScore(command.name, query);
		if (score === null) return;
		const key = `${command.source}\0${command.name}`;
		if (!unique.has(key)) unique.set(key, { command, index, score });
	});

	return [...unique.values()]
		.sort((a, b) => a.score - b.score || a.index - b.index)
		.map(({ command }) => ({
			value: command.name,
			label: command.name,
			description: `[${command.source}]${command.description ? ` ${command.description}` : ""}`,
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

	for (const match of text.matchAll(RESOURCE_TOKEN_PATTERN)) {
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

export function extractReferencedCommands(text: string, commands: readonly ComposableCommand[]): ComposableCommand[] {
	const byInvocation = new Map(commands.map((command) => [command.name, command]));
	const selected = new Map<string, ComposableCommand>();

	for (const match of text.matchAll(RESOURCE_TOKEN_PATTERN)) {
		const token = match[2];
		if (!token) continue;
		const invocation = byInvocation.has(token) ? token : token.replace(/[),.;!?\]}]+$/, "");
		const command = byInvocation.get(invocation);
		if (!command) continue;
		const key = `${command.source}\0${command.name}\0${command.path}`;
		if (!selected.has(key)) selected.set(key, command);
	}

	return [...selected.values()];
}

export const INLINE_CONTEXT_REFERENCES_MARKER = "pi-extension:inline-context:v2";

function describeReference(resource: LoadedContextResource): string {
	if (resource.source === "skill") {
		const name = resource.name.replace(/^skill:/, "");
		return `- Skill \`${name}\`: ${resource.path} (relative paths inside it resolve against ${resource.baseDir})`;
	}
	return `- Prompt template \`/${resource.name}\`: ${resource.path} (its $ARGUMENTS, $@, and $1, $2, \u2026 placeholders refer to the request above)`;
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
