import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { MatchRange } from "../core/matcher.ts";
import type { Palette } from "./palette.ts";

/** Tabs become one space and carriage returns are dropped, keeping range offsets aligned. */
function normalize(text: string, ranges: readonly MatchRange[]): { text: string; ranges: MatchRange[] } {
	let out = "";
	const shift: number[] = [];
	let removed = 0;
	for (let index = 0; index < text.length; index++) {
		shift.push(removed);
		const char = text[index]!;
		if (char === "\r") {
			removed++;
			continue;
		}
		out += char === "\t" ? " " : char;
	}
	shift.push(removed);
	return {
		text: out,
		ranges: ranges.map(([start, end]) => [start - shift[start]!, end - shift[end]!] as const),
	};
}

/** Printable ASCII only: one column per character, so `length` is the visible width. */
function isAscii(text: string): boolean {
	return /^[\x20-\x7e]*$/u.test(text);
}

/**
 * Wrapped, highlighted preview lines for one item. Results are cached per item key and width, so
 * scrolling and redraws only slice cached lines.
 */
export interface PreviewLines {
	lines: string[];
	/** Wrapped line holding the first match (approximate within a wrapped paragraph), or -1. */
	firstMatch: number;
}

export class Preview {
	private cache: ({ key: string; width: number } & PreviewLines) | undefined;

	/** Cached lines for `key` at `width`, if any; lets callers skip computing match ranges. */
	cached(key: string, width: number): PreviewLines | undefined {
		return this.cache && this.cache.key === key && this.cache.width === width ? this.cache : undefined;
	}

	lines(key: string, text: string, ranges: readonly MatchRange[], width: number, palette: Palette): PreviewLines {
		const hit = this.cached(key, width);
		if (hit) return hit;
		const normalized = normalize(text, ranges);
		let styled = "";
		let at = 0;
		for (const [start, end] of normalized.ranges) {
			styled += normalized.text.slice(at, start) + palette.match(normalized.text.slice(start, end));
			at = end;
		}
		styled += normalized.text.slice(at);
		const lines: string[] = [];
		let firstMatch = -1;
		const target = normalized.ranges[0]?.[0];
		let offset = 0;
		const plainLines = normalized.text.split("\n");
		for (const [index, line] of styled.split("\n").entries()) {
			const plain = plainLines[index] ?? "";
			if (firstMatch < 0 && target !== undefined && target <= offset + plain.length) {
				firstMatch =
					lines.length +
					Math.floor(visibleWidth(plain.slice(0, Math.max(0, target - offset))) / Math.max(1, width));
			}
			offset += plain.length + 1;
			// Plain lines are measured without ANSI parsing; only styled or long lines need the wrapper.
			if (line.length <= width && line === plain && isAscii(plain)) lines.push(line);
			else if (visibleWidth(line) <= width) lines.push(line);
			else lines.push(...wrapTextWithAnsi(line, Math.max(1, width)));
		}
		this.cache = { key, width, lines, firstMatch };
		return this.cache;
	}
}
