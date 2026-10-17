/**
 * Case- and accent-insensitive folding with an optional map back to original offsets.
 *
 * ASCII text (the common case) folds with `toLowerCase()` and needs no map: folded and original
 * offsets are identical. Other text folds per code point (NFD, combining marks removed, lower
 * case), so `é` matches `e` and highlight ranges still land on the original characters.
 */
export interface Folded {
	text: string;
	/** `map[i]` is the original UTF-16 offset of folded code unit `i`; absent when offsets match. */
	map?: Uint32Array;
}

const COMBINING = /\p{M}+/gu;
/** Fold results for non-ASCII characters; the alphabet in real text is small. */
const charCache = new Map<string, string>();

function foldChar(char: string): string {
	let folded = charCache.get(char);
	if (folded === undefined) {
		folded = char.normalize("NFD").replace(COMBINING, "").toLowerCase();
		if (charCache.size < 65_536) charCache.set(char, folded);
	}
	return folded;
}

function isAscii(text: string): boolean {
	for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) > 127) return false;
	return true;
}

export function fold(text: string): Folded {
	if (isAscii(text)) return { text: text.toLowerCase() };
	const pieces: string[] = [];
	// A folded character is at most three code units (for example decomposed Hangul).
	let map = new Uint32Array(text.length * 3);
	let length = 0;
	let shifted = false;
	let run = 0;
	const flush = (end: number) => {
		if (end <= run) return;
		pieces.push(text.slice(run, end).toLowerCase());
		for (let offset = run; offset < end; offset++) map[length++] = offset;
	};
	for (let index = 0; index < text.length;) {
		if (text.charCodeAt(index) < 128) {
			index++;
			continue;
		}
		flush(index);
		const point = text.codePointAt(index)!;
		const char = point > 0xffff ? text.slice(index, index + 2) : text[index]!;
		const folded = foldChar(char);
		if (length + folded.length > map.length) {
			const grown = new Uint32Array(map.length * 2);
			grown.set(map);
			map = grown;
		}
		for (let unit = 0; unit < folded.length; unit++) map[length++] = index;
		// Offsets only diverge when a character folds to a different number of code units.
		if (folded.length !== char.length) shifted = true;
		pieces.push(folded);
		index += char.length;
		run = index;
	}
	flush(text.length);
	const folded = pieces.join("");
	if (!shifted) return { text: folded };
	return { text: folded, map: map.slice(0, length) };
}

/** Folded `[start, end)` → original `[start, end)`. */
export function toOriginalRange(
	original: string,
	map: Uint32Array | undefined,
	start: number,
	end: number,
): [number, number] {
	if (!map) return [start, end];
	if (start >= map.length) return [original.length, original.length];
	const from = map[start]!;
	const last = map[Math.min(end, map.length) - 1]!;
	const point = original.codePointAt(last) ?? 0;
	return [from, last + (point > 0xffff ? 2 : 1)];
}

/** Word characters: letters and digits. Anything else (space, `/`, `-`, `_`, `.`, `:`) starts a word. */
export function isWordChar(code: number, char: string): boolean {
	if (code < 128) {
		return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
	}
	return /[\p{L}\p{N}]/u.test(char);
}

export function isBoundary(folded: string, index: number): boolean {
	if (index === 0) return true;
	const code = folded.charCodeAt(index - 1);
	return !isWordChar(code, folded[index - 1]!);
}
