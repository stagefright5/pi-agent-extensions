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

const RESOURCE_TOKEN_PATTERN = /(^|[\s([{])\/([^\s/]+)/g;

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

export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: '"' | "'" | null = null;

	for (const character of argsString) {
		if (inQuote) {
			if (character === inQuote) {
				inQuote = null;
			} else {
				current += character;
			}
		} else if (character === '"' || character === "'") {
			inQuote = character;
		} else if (/\s/.test(character)) {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += character;
		}
	}

	if (current) args.push(current);
	return args;
}

export function substitutePromptArguments(content: string, args: readonly string[]): string {
	const allArgs = args.join(" ");
	return content.replace(
		/\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
		(_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
			if (defaultTarget) {
				const value =
					defaultTarget === "@" || defaultTarget === "ARGUMENTS"
						? allArgs
						: args[Number.parseInt(defaultTarget, 10) - 1];
				return value || defaultValue;
			}

			if (sliceStart) {
				const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
				if (sliceLength) {
					return args.slice(start, start + Number.parseInt(sliceLength, 10)).join(" ");
				}
				return args.slice(start).join(" ");
			}

			if (simple === "ARGUMENTS" || simple === "@") return allArgs;
			return args[Number.parseInt(simple, 10) - 1] ?? "";
		},
	);
}

function escapeXmlAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function displayName(resource: LoadedContextResource): string {
	return resource.source === "skill" ? resource.name.replace(/^skill:/, "") : `prompt:${resource.name}`;
}

function formatResourceSection(resource: LoadedContextResource, originalArgs: readonly string[]): string {
	if (resource.source === "skill") {
		const skillName = resource.name.replace(/^skill:/, "");
		return [
			`## Skill: ${skillName}`,
			"",
			`Location: ${resource.path}`,
			`References are relative to ${resource.baseDir}.`,
			"",
			resource.body.trim(),
		].join("\n");
	}

	return [
		`## Prompt template: ${resource.name}`,
		"",
		`Location: ${resource.path}`,
		"",
		substitutePromptArguments(resource.body.trim(), originalArgs),
	].join("\n");
}

export function formatContextBundle(originalText: string, resources: readonly LoadedContextResource[]): string {
	if (resources.length === 0) return originalText;

	const args = parseCommandArgs(originalText);
	const names = resources.map(displayName);
	const bundleName = names.join(", ");
	const location = resources.length === 1 ? resources[0]!.path : "multiple";
	const sections = resources.map((resource) => formatResourceSection(resource, args));
	const content = [
		`<!-- ${INLINE_CONTEXT_BUNDLE_MARKER} -->`,
		`${resources.length} context resource${resources.length === 1 ? " was" : "s were"} explicitly selected. Apply the relevant instructions to the unchanged user task below.`,
		"",
		sections.join("\n\n---\n\n"),
	].join("\n");

	return `<skill name="${escapeXmlAttribute(bundleName)}" location="${escapeXmlAttribute(location)}">\n${content}\n</skill>\n\n${originalText}`;
}

export function isExpandedContextBundle(text: string): boolean {
	return text.startsWith("<skill ") && text.includes(`<!-- ${INLINE_CONTEXT_BUNDLE_MARKER} -->`);
}
