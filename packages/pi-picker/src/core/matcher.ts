import { fold, isBoundary, toOriginalRange } from "./fold.ts";

/**
 * Multi-word matching. Every query word must match (order is free). A word scores highest as a
 * contiguous substring at a word start, then as a later substring, then as a fuzzy subsequence
 * that rewards consecutive letters and word starts. A multi-word query that also appears as one
 * phrase gets a bonus. Scores are non-negative; `NO_MATCH` marks a rejected item.
 */
export interface PreparedQuery {
	raw: string;
	folded: string;
	tokens: readonly string[];
	/** Tokens joined by single spaces; used for the phrase bonus and incremental narrowing. */
	phrase: string;
}

export type MatchRange = readonly [start: number, end: number];

export const NO_MATCH = -1;
/** A confirmed fuzzy match whose exact score was skipped (see `scoreTokenHinted` `bound`). */
export const UNSCORED = -2;

const SUBSTRING = 1000;
const CHAR = 16;
const WORD_START = 400;
const TEXT_START = 100;
const FUZZY_CHAR = 16;
const FUZZY_CONSECUTIVE = 24;
const FUZZY_WORD_START = 48;
const FUZZY_GAP = 2;
const FUZZY_MAX_GAP_PENALTY = 60;
/** Below the weakest substring score (1000 + 16 - 100), so any substring beats any fuzzy match. */
export const FUZZY_CEILING = 899;
/** Scores at or above this are substring matches. */
export const SUBSTRING_FLOOR = 900;
export const PHRASE = 600;
const MAX_OCCURRENCES = 8;

export function prepareQuery(raw: string): PreparedQuery {
	const folded = fold(raw).text;
	const tokens = folded.split(/\s+/u).filter(Boolean);
	return { raw, folded, tokens, phrase: tokens.join(" ") };
}

function substringScore(folded: string, token: string): number {
	const first = folded.indexOf(token);
	return first < 0 ? NO_MATCH : substringScoreFrom(folded, token, first);
}

/** Earliest word-start occurrence at or after `first`, or -1. */
function wordStartAfter(folded: string, token: string, first: number): number {
	let index = first;
	for (let seen = 0; index >= 0 && seen < MAX_OCCURRENCES; seen++) {
		if (isBoundary(folded, index)) return index;
		index = folded.indexOf(token, index + 1);
	}
	return -1;
}

let positions = new Int32Array(64);

/** Backward pass from the end of the greedy forward match: each letter takes its latest position. */
function tighten(folded: string, token: string, end: number): void {
	if (positions.length < token.length) positions = new Int32Array(token.length * 2);
	for (let tokenIndex = token.length - 1, at = end; tokenIndex >= 0; tokenIndex--) {
		const found = folded.lastIndexOf(token[tokenIndex]!, at);
		positions[tokenIndex] = found;
		at = found - 1;
	}
}

/** Tightest fuzzy window (forward to the first complete match, then backward); fills `positions`. */
function fuzzyWindow(folded: string, token: string): number {
	let end = -1;
	for (let tokenIndex = 0, at = 0; tokenIndex < token.length; tokenIndex++) {
		const found = folded.indexOf(token[tokenIndex]!, at);
		if (found < 0) return -1;
		end = found;
		at = found + 1;
	}
	tighten(folded, token, end);
	return token.length;
}

function scorePositions(folded: string, count: number): number {
	let score = 0;
	for (let index = 0; index < count; index++) {
		const position = positions[index]!;
		score += FUZZY_CHAR;
		if (isBoundary(folded, position)) score += FUZZY_WORD_START;
		if (index > 0) {
			const gap = position - positions[index - 1]! - 1;
			score += gap === 0 ? FUZZY_CONSECUTIVE : -Math.min(gap * FUZZY_GAP, FUZZY_MAX_GAP_PENALTY);
		}
	}
	return Math.max(0, Math.min(score, FUZZY_CEILING));
}

function fuzzyScore(folded: string, token: string): number {
	const count = fuzzyWindow(folded, token);
	return count < 0 ? NO_MATCH : scorePositions(folded, count);
}

function fuzzyScoreEnding(folded: string, token: string, end: number): number {
	tighten(folded, token, end);
	return scorePositions(folded, token.length);
}

export function scoreToken(folded: string, token: string): number {
	const substring = substringScore(folded, token);
	return substring !== NO_MATCH ? substring : fuzzyScore(folded, token);
}

/** Narrowing state: substring offset unknown (search from 0). */
export const FIRST_UNKNOWN = -1;
/** Narrowing state: the prefix was not a substring, so no extension of it can be. */
export const FIRST_NONE = -2;
/** Narrowing state: greedy forward end unknown (scan from 0). */
export const END_UNKNOWN = -1;

/** Written by `scoreTokenHinted`: the token's first substring offset, or `FIRST_NONE`. */
export let tokenFirst = FIRST_UNKNOWN;
/** Written by `scoreTokenHinted`: end of the greedy forward subsequence scan, or `END_UNKNOWN`. */
export let tokenEnd = END_UNKNOWN;

/**
 * Score `token` using what was learned for a shorter prefix of it (`prefixLength` code units):
 * - extending a word never creates an earlier substring, and a prefix that was not a substring
 *   rules out a substring match entirely;
 * - the greedy forward subsequence scan is prefix-consistent, so it resumes after the prefix's end.
 * When the match is fuzzy and even the best fuzzy score stays below `bound`, returns `UNSCORED`.
 */
export function scoreTokenHinted(
	folded: string,
	token: string,
	first: number,
	end: number,
	prefixLength: number,
	bound = Number.NEGATIVE_INFINITY,
): number {
	const substring = first === FIRST_NONE ? -1 : folded.indexOf(token, first >= 0 ? first : 0);
	let greedy = END_UNKNOWN;
	if (end >= 0 && prefixLength > 0) {
		greedy = end;
		for (let index = prefixLength; index < token.length; index++) {
			greedy = folded.indexOf(token[index]!, greedy + 1);
			if (greedy < 0) break;
		}
	} else if (substring >= 0 && token.length === 1) {
		greedy = substring;
	} else if (substring < 0) {
		greedy = -1;
		for (let index = 0; index < token.length; index++) {
			greedy = folded.indexOf(token[index]!, greedy + 1);
			if (greedy < 0) break;
		}
	}
	if (substring >= 0) {
		tokenFirst = substring;
		tokenEnd = greedy;
		return substringScoreFrom(folded, token, substring);
	}
	if (greedy < 0) return NO_MATCH;
	tokenFirst = FIRST_NONE;
	tokenEnd = greedy;
	// A fuzzy score never exceeds the ceiling: skip the window work when it could not matter.
	return FUZZY_CEILING < bound ? UNSCORED : fuzzyScoreEnding(folded, token, greedy);
}

/**
 * The earliest word-start occurrence is the best one: later occurrences only lose position points,
 * and any word-start occurrence beats every mid-word one.
 */
function substringScoreFrom(folded: string, token: string, first: number): number {
	const start = wordStartAfter(folded, token, first);
	const best = start >= 0 ? start : first;
	return (
		SUBSTRING +
		token.length * CHAR +
		(start >= 0 ? WORD_START : 0) +
		(best === 0 ? TEXT_START : 0) -
		Math.min(best, 400) * 0.25
	);
}

/** Score folded text against a prepared query; `NO_MATCH` when any word fails. */
export function scoreText(folded: string, query: PreparedQuery): number {
	const { tokens } = query;
	if (tokens.length === 0) return 0;
	let total = 0;
	for (let index = 0; index < tokens.length; index++) {
		const score = scoreToken(folded, tokens[index]!);
		if (score === NO_MATCH) return NO_MATCH;
		total += score;
	}
	return total + phraseBonus(folded, query);
}

/** Bonus when a multi-word query also appears verbatim as one phrase. */
export function phraseBonus(folded: string, query: PreparedQuery): number {
	return query.tokens.length > 1 && folded.includes(query.phrase) ? PHRASE : 0;
}

function merge(ranges: [number, number][]): MatchRange[] {
	ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else merged.push([range[0], range[1]]);
	}
	return merged;
}

/**
 * Matched ranges in original-text offsets, merged and sorted. Call this only for rows on screen:
 * scoring never allocates ranges.
 */
export function matchRanges(
	text: string,
	folded: string,
	map: Uint32Array | undefined,
	query: PreparedQuery,
): MatchRange[] {
	const ranges: [number, number][] = [];
	const add = (start: number, end: number) => ranges.push(toOriginalRange(text, map, start, end));
	for (const token of query.tokens) {
		let index = folded.indexOf(token);
		if (index >= 0) {
			for (let seen = 0; index >= 0 && seen < 32; seen++) {
				add(index, index + token.length);
				index = folded.indexOf(token, index + token.length);
			}
			continue;
		}
		const count = fuzzyWindow(folded, token);
		for (let at = 0; at < count;) {
			let end = at + 1;
			while (end < count && positions[end] === positions[end - 1]! + 1) end++;
			add(positions[at]!, positions[end - 1]! + 1);
			at = end;
		}
	}
	return merge(ranges);
}
