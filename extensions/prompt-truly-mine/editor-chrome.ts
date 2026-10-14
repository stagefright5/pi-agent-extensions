import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

/** Border-only decoration. Never process content or autocomplete rows. */
export function composerBorder(
	width: number,
	labels: readonly string[],
	color: (text: string) => string,
	rightLabels: readonly string[] = [],
	labelColor: (text: string) => string = (text) => text,
): string {
	const columns = Math.max(0, Math.floor(width));
	const fitting: string[] = [];
	for (const label of labels) {
		const candidate = [...fitting, label].join(" · ");
		if (visibleWidth(candidate) + 6 <= columns) fitting.push(label);
	}
	const lead = fitting.length ? `─ ${fitting.join(" · ")} ` : "";
	const right: string[] = [];
	for (const label of rightLabels) {
		const candidate = [...right, label].join(" · ");
		if (visibleWidth(lead) + visibleWidth(candidate) + 6 <= columns) right.push(label);
	}
	const tail = right.length ? ` ${right.join(" · ")} ─` : "";
	const fill = "─".repeat(Math.max(0, columns - visibleWidth(lead) - visibleWidth(tail)));
	return (
		(fitting.length ? color("─ ") + labelColor(fitting.join(" · ")) + color(" ") : "") +
		color(fill) +
		(right.length ? color(" ") + labelColor(right.join(" · ")) + color(" ─") : "")
	);
}

/** Preserve native overflow-label placement, but do not color its text as a decorative rule. */
export function readableScrollBorder(
	line: string,
	color: (text: string) => string,
	labelColor: (text: string) => string,
): string {
	return stripTerminalSequences(line)
		.split(/(─+)/u)
		.map((part) => (/^─+$/u.test(part) ? color(part) : labelColor(part)))
		.join("");
}
