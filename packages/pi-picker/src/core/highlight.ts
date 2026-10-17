import { visibleWidth } from "@earendil-works/pi-tui";
import type { MatchRange } from "./matcher.ts";

/** One display line: tabs and line breaks become spaces 1:1, so range offsets stay valid. */
export function singleLine(text: string): string {
	return text.replace(/[\t\n\r\v\f]/gu, " ");
}

/** Wrap each range with `style`; ranges must be sorted, merged, original-text offsets. */
export function applyRanges(text: string, ranges: readonly MatchRange[], style: (text: string) => string): string {
	if (ranges.length === 0) return text;
	let out = "";
	let at = 0;
	for (const [start, end] of ranges) {
		const from = Math.max(at, Math.min(start, text.length));
		const to = Math.max(from, Math.min(end, text.length));
		out += text.slice(at, from);
		if (to > from) out += style(text.slice(from, to));
		at = to;
	}
	return out + text.slice(at);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A window of at most `maxWidth` cells around the first match, with `…` on cut edges. Returns the
 * shifted ranges for the window. Works on graphemes, so wide and combined characters never split.
 */
export function excerpt(
	text: string,
	ranges: readonly MatchRange[],
	maxWidth: number,
): { text: string; ranges: MatchRange[] } {
	if (maxWidth <= 0) return { text: "", ranges: [] };
	if (visibleWidth(text) <= maxWidth) return { text, ranges: [...ranges] };
	const graphemes = [...segmenter.segment(text)];
	const focus = ranges[0]?.[0] ?? 0;
	let first = graphemes.findIndex((grapheme) => grapheme.index + grapheme.segment.length > focus);
	if (first < 0) first = 0;
	// Keep roughly a third of the window as leading context before the first match.
	let start = first;
	let lead = 0;
	const budget = Math.floor(maxWidth / 3);
	while (start > 0) {
		const width = visibleWidth(graphemes[start - 1]!.segment);
		if (lead + width > budget) break;
		lead += width;
		start--;
	}
	const prefix = start > 0 ? "…" : "";
	let width = visibleWidth(prefix);
	let end = start;
	while (end < graphemes.length) {
		const next = visibleWidth(graphemes[end]!.segment);
		const suffix = end + 1 < graphemes.length ? 1 : 0;
		if (width + next + suffix > maxWidth) break;
		width += next;
		end++;
	}
	// Widen backwards when the tail fits entirely (match near the end of the text).
	if (end === graphemes.length) {
		while (start > 0) {
			const next = visibleWidth(graphemes[start - 1]!.segment);
			if (width + next > maxWidth) break;
			width += next;
			start--;
		}
	}
	const from = graphemes[start]?.index ?? text.length;
	const to = end < graphemes.length ? graphemes[end]!.index : text.length;
	const head = start > 0 ? "…" : "";
	const tail = to < text.length ? "…" : "";
	const shift = head.length - from;
	const shifted: MatchRange[] = [];
	for (const [rangeStart, rangeEnd] of ranges) {
		const clippedStart = Math.max(rangeStart, from);
		const clippedEnd = Math.min(rangeEnd, to);
		if (clippedEnd > clippedStart) shifted.push([clippedStart + shift, clippedEnd + shift]);
	}
	const view = head + text.slice(from, to) + tail;
	if (visibleWidth(view) <= maxWidth) return { text: view, ranges: shifted };
	// Too narrow for ellipses: plain leading cut.
	let cut = 0;
	let used = 0;
	for (const grapheme of graphemes) {
		const next = visibleWidth(grapheme.segment);
		if (used + next > maxWidth) break;
		used += next;
		cut = grapheme.index + grapheme.segment.length;
	}
	return {
		text: text.slice(0, cut),
		ranges: ranges.filter(([start]) => start < cut).map(([start, end]) => [start, Math.min(end, cut)] as const),
	};
}
