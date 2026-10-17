import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Preserve native overflow-label placement and readable text, replacing rules with blank padding. */
export function readableScrollChrome(line: string, labelColor: (text: string) => string): string {
	return stripTerminalSequences(line)
		.split(/(─+)/u)
		.map((part) => (/^─+$/u.test(part) ? " ".repeat(part.length) : labelColor(part)))
		.join("");
}
