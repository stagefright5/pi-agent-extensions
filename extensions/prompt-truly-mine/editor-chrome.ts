import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

/** A rule-free header. Never process content or autocomplete rows. */
export function composerHeader(
	width: number,
	labels: readonly string[],
	rightLabels: readonly string[] = [],
	labelColor: (text: string) => string = (text) => text,
): string {
	const columns = Math.max(0, Math.floor(width));
	const fitting: string[] = [];
	for (const label of labels) {
		const candidate = [...fitting, label].join(" · ");
		if (visibleWidth(candidate) + 6 <= columns) fitting.push(label);
	}
	const lead = fitting.length ? `  ${fitting.join(" · ")} ` : "";
	const right: string[] = [];
	for (const label of rightLabels) {
		const candidate = [...right, label].join(" · ");
		if (visibleWidth(lead) + visibleWidth(candidate) + 6 <= columns) right.push(label);
	}
	const tail = right.length ? ` ${right.join(" · ")}  ` : "";
	const fill = " ".repeat(Math.max(0, columns - visibleWidth(lead) - visibleWidth(tail)));
	return (
		(fitting.length ? "  " + labelColor(fitting.join(" · ")) + " " : "") +
		fill +
		(right.length ? " " + labelColor(right.join(" · ")) + "  " : "")
	);
}

/** Preserve native overflow-label placement and readable text, replacing rules with blank padding. */
export function readableScrollChrome(line: string, labelColor: (text: string) => string): string {
	return stripTerminalSequences(line)
		.split(/(─+)/u)
		.map((part) => (/^─+$/u.test(part) ? " ".repeat(part.length) : labelColor(part)))
		.join("");
}
