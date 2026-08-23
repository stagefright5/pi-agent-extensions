export const ASK_POLICY = `Do not guess and do not silently pick defaults. For any of the following, stop and ask me:

- A decision with more than one reasonable option (library, pattern, file location, naming, scope, approach)
- An ambiguous or underspecified part of my request
- A doubt about intent, expected behavior, or edge cases
- A tradeoff you would otherwise resolve on your own
- Anything destructive, irreversible, or outward-facing
- A blocked step where you'd otherwise assume your way past it

How to ask, in order of preference:

1. If you have a tool for putting a multiple-choice question to the user — named something like AskUserQuestion, ask_user, ask_followup_question, elicit, request_input, or any equivalent — use it. Prefer it over prose every time.
2. If you have no such tool, ask in your reply text: number the questions, and under each one list 2-4 concrete lettered options so I can answer with a letter.

Either way: batch related questions into one turn rather than drip-feeding them, make options concrete and mutually exclusive, put your recommendation first and mark it as recommended, and say what choosing each option actually means. Ask before doing the work that depends on the answer.

Do everything that does not depend on an open question first, then ask. Do not ask what you can verify yourself from the code, the filesystem, or a command — check first, then ask only what is genuinely mine to decide.`;

export function parseAskArguments(argsString: string): string[] {
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

export function buildAskPrompt(argsString: string): string {
	const task = parseAskArguments(argsString).join(" ");
	return task ? `${ASK_POLICY}\n\n${task}` : ASK_POLICY;
}
