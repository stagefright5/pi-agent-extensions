import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

export interface TextPosition {
	line: number;
	col: number;
}

/** One rendered composer content row, identified by its logical source range. */
export interface VisualRow {
	logicalLine: number;
	startCol: number;
	length: number;
}

export interface TextRange {
	start: TextPosition;
	end: TextPosition;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const SELECTED = "\x1b[7m";
const UNSELECTED = "\x1b[27m";

export function comparePositions(a: TextPosition, b: TextPosition): number {
	return a.line === b.line ? a.col - b.col : a.line - b.line;
}

export function orderedRange(anchor: TextPosition, focus: TextPosition): TextRange | undefined {
	const order = comparePositions(anchor, focus);
	if (order === 0) return undefined;
	return order < 0 ? { start: anchor, end: focus } : { start: focus, end: anchor };
}

/** Return source text only: no inset, wrap breaks, cursor or terminal styling. */
export function selectedText(lines: readonly string[], range: TextRange): string {
	const { start, end } = range;
	if (start.line === end.line) return (lines[start.line] ?? "").slice(start.col, end.col);
	return [
		(lines[start.line] ?? "").slice(start.col),
		...lines.slice(start.line + 1, end.line),
		(lines[end.line] ?? "").slice(0, end.col),
	].join("\n");
}

/** Map a terminal column on a content row to the nearest grapheme boundary. */
export function positionAtColumn(
	lines: readonly string[],
	row: VisualRow,
	column: number,
	isLastSegment: boolean,
): TextPosition {
	const chunk = (lines[row.logicalLine] ?? "").slice(row.startCol, row.startCol + row.length);
	let width = 0;
	let index = chunk.length;
	let last = 0;
	for (const part of graphemes.segment(chunk)) {
		const next = width + visibleWidth(part.segment);
		last = part.index;
		if (column < next) {
			// Pick the closer edge, so dragging to the right half includes a cell.
			index = column - width < (next - width) / 2 ? part.index : part.index + part.segment.length;
			break;
		}
		width = next;
	}
	// A wrapped row's end belongs to the next row; keep it inside this row.
	if (!isLastSegment && index === chunk.length && chunk.length > 0) index = last;
	return { line: row.logicalLine, col: row.startCol + index };
}

export function wordRangeAt(lines: readonly string[], position: TextPosition): TextRange | undefined {
	const line = lines[position.line] ?? "";
	for (const part of words.segment(line)) {
		const end = part.index + part.segment.length;
		if (position.col < part.index || position.col >= end) continue;
		if (!part.segment.trim()) return undefined;
		return { start: { line: position.line, col: part.index }, end: { line: position.line, col: end } };
	}
	return undefined;
}

export function lineRangeAt(lines: readonly string[], line: number): TextRange | undefined {
	const length = (lines[line] ?? "").length;
	return length ? { start: { line, col: 0 }, end: { line, col: length } } : undefined;
}

/** Reverse only selected source cells; the left/right inset is never highlighted. */
export function highlightRow(
	rendered: string,
	lines: readonly string[],
	row: VisualRow,
	range: TextRange,
	padding: number,
	width: number,
	isLastSegment: boolean,
): string {
	const rowStart = { line: row.logicalLine, col: row.startCol };
	const rowEnd = { line: row.logicalLine, col: row.startCol + row.length };
	if (comparePositions(range.end, rowStart) <= 0 || comparePositions(range.start, rowEnd) > 0) return rendered;
	const from = comparePositions(range.start, rowStart) > 0 ? range.start.col : row.startCol;
	const to = comparePositions(range.end, rowEnd) < 0 ? range.end.col : rowEnd.col;
	const chunk = (lines[row.logicalLine] ?? "").slice(row.startCol, rowEnd.col);
	let start = padding + visibleWidth(chunk.slice(0, from - row.startCol));
	let end = padding + visibleWidth(chunk.slice(0, to - row.startCol));
	// Show a selected newline as one cell, still inside the content area.
	if (isLastSegment && range.end.line > row.logicalLine && end < width - padding) end++;
	start = Math.max(padding, Math.min(start, width - padding));
	end = Math.max(start, Math.min(end, width - padding));
	if (end === start) return rendered;
	return (
		sliceByColumn(rendered, 0, start, true) +
		SELECTED +
		sliceByColumn(rendered, start, end - start, true) +
		UNSELECTED +
		sliceByColumn(rendered, end, Math.max(0, visibleWidth(rendered) - end), true)
	);
}
