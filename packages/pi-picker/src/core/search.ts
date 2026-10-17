import type { SearchIndex } from "./index.ts";
import {
	END_UNKNOWN,
	FIRST_UNKNOWN,
	NO_MATCH,
	PHRASE,
	phraseBonus,
	prepareQuery,
	scoreToken,
	scoreTokenHinted,
	SUBSTRING_FLOOR,
	FUZZY_CEILING,
	tokenEnd,
	tokenFirst,
	UNSCORED,
	type PreparedQuery,
} from "./matcher.ts";

export interface SearchResult {
	query: PreparedQuery;
	/** Item indices, best first; at most `limit`. */
	ids: Uint32Array;
	scores: Float64Array;
	/** Every matching item, not only the returned window. */
	total: number;
}

export interface SearcherOptions {
	/** How many ranked results to keep. Raise it when the user scrolls near the end. */
	limit?: number;
	/** 0..1 per item (for example recency). Added as up to `boostWeight` points. */
	boost?: (index: number) => number;
	boostWeight?: number;
	/** Above this many candidates `searchAsync` yields between slices. */
	sliceSize?: number;
}

export interface SearchCall {
	/** 1 = allowed. Absent = every item. Pass the same array instance while filters are unchanged. */
	allowed?: Uint8Array;
	limit?: number;
}

const DEFAULT_LIMIT = 500;
const DEFAULT_SLICE = 25_000;

/** Fixed-size min-heap of (score, index) keeping the best `capacity` entries. Ties prefer lower indices. */
class TopK {
	readonly scores: Float64Array;
	readonly ids: Uint32Array;
	size = 0;

	readonly capacity: number;

	constructor(capacity: number) {
		this.capacity = capacity;
		this.scores = new Float64Array(capacity);
		this.ids = new Uint32Array(capacity);
	}

	/** True when a is worse than b. */
	private worse(aScore: number, aId: number, bScore: number, bId: number): boolean {
		return aScore < bScore || (aScore === bScore && aId > bId);
	}

	push(score: number, id: number): void {
		const { scores, ids } = this;
		if (this.size < this.capacity) {
			let at = this.size++;
			while (at > 0) {
				const parent = (at - 1) >> 1;
				if (!this.worse(score, id, scores[parent]!, ids[parent]!)) break;
				scores[at] = scores[parent]!;
				ids[at] = ids[parent]!;
				at = parent;
			}
			scores[at] = score;
			ids[at] = id;
			return;
		}
		if (this.capacity === 0 || this.worse(score, id, scores[0]!, ids[0]!)) return;
		let at = 0;
		const size = this.size;
		for (;;) {
			const left = at * 2 + 1;
			if (left >= size) break;
			const right = left + 1;
			let child = left;
			if (right < size && this.worse(scores[right]!, ids[right]!, scores[left]!, ids[left]!)) child = right;
			if (!this.worse(scores[child]!, ids[child]!, score, id)) break;
			scores[at] = scores[child]!;
			ids[at] = ids[child]!;
			at = child;
		}
		scores[at] = score;
		ids[at] = id;
	}

	/** Scores below this cannot enter (ties are settled by `push`). */
	threshold(): number {
		return this.size < this.capacity ? Number.NEGATIVE_INFINITY : this.scores[0]!;
	}

	/** Drain best-first. */
	sorted(): { ids: Uint32Array; scores: Float64Array } {
		const order = Array.from({ length: this.size }, (_, index) => index);
		order.sort((a, b) => this.scores[b]! - this.scores[a]! || this.ids[a]! - this.ids[b]!);
		return {
			ids: Uint32Array.from(order, (index) => this.ids[index]!),
			scores: Float64Array.from(order, (index) => this.scores[index]!),
		};
	}
}

interface Narrowing {
	tokens: readonly string[];
	version: number;
	allowed?: Uint8Array;
	survivors: Uint32Array;
	/** Per survivor: summed known scores of every token but the last. */
	fixed: Float64Array;
	/** Per survivor: bitmask of earlier tokens whose fuzzy score was skipped (each at most the fuzzy ceiling). */
	lazy: Uint32Array;
	/** Per survivor: score of the last token. */
	tail: Float64Array;
	/** Per survivor: narrowing state for the last token (see `scoreTokenHinted`). */
	firsts: Int32Array;
	ends: Int32Array;
	limit: number;
	result: SearchResult;
}

interface Plan {
	candidates?: Uint32Array;
	/** Per candidate base score carried over from the previous search. */
	base?: Float64Array;
	baseLazy?: Uint32Array;
	/** Tokens that still need scoring for every candidate (all of them on a full scan). */
	pending: readonly string[];
	/** Narrowing state for the last pending token when it extends the previous last token. */
	firsts?: Int32Array;
	ends?: Int32Array;
	prefixLength: number;
	/** The previous result, when the query did not change. */
	reuse?: SearchResult;
}

interface Scan {
	survivors: Uint32Array;
	fixed: Float64Array;
	lazy: Uint32Array;
	tail: Float64Array;
	firsts: Int32Array;
	ends: Int32Array;
	count: number;
}

const MAX_LAZY_TOKENS = 31;

function popcount(mask: number): number {
	let count = 0;
	for (let bits = mask; bits; bits &= bits - 1) count++;
	return count;
}

const same = (a: readonly string[], b: readonly string[], length: number) => {
	for (let index = 0; index < length; index++) if (a[index] !== b[index]) return false;
	return true;
};

/**
 * Ranked search with incremental narrowing. When the new query only extends the last word or adds
 * a word, only the previous survivors are rescored, and only for the changed word; scores of the
 * unchanged words are carried over. Any index mutation, filter change, or unrelated query starts over.
 */
export class Searcher<T> {
	private last: Narrowing | undefined;
	private generation = 0;
	/**
	 * Two reusable scan buffers. A scan always writes the buffer that does not hold `last`, whose
	 * survivors it may be reading. A superseded async scan stops at its next slice boundary.
	 */
	private readonly buffers: (Scan | undefined)[] = [undefined, undefined];
	private lastBuffer = 1;
	private writing = 0;

	readonly index: SearchIndex<T>;
	private readonly options: SearcherOptions;

	constructor(index: SearchIndex<T>, options: SearcherOptions = {}) {
		this.index = index;
		this.options = options;
	}

	private plan(query: PreparedQuery, allowed: Uint8Array | undefined, limit: number): Plan {
		const last = this.last;
		const tokens = query.tokens;
		if (last && last.version === this.index.version && last.allowed === allowed) {
			const previous = last.tokens;
			const n = previous.length;
			if (tokens.length === n && same(tokens, previous, n - 1) && tokens[n - 1]!.startsWith(previous[n - 1]!)) {
				const reuse = tokens[n - 1] === previous[n - 1] && last.limit === limit ? last.result : undefined;
				return {
					candidates: last.survivors,
					base: last.fixed,
					baseLazy: last.lazy,
					pending: [tokens[n - 1]!],
					firsts: last.firsts,
					ends: last.ends,
					prefixLength: previous[n - 1]!.length,
					reuse: reuse && { ...reuse, query },
				};
			}
			if (tokens.length === n + 1 && same(tokens, previous, n)) {
				const length = last.survivors.length;
				const base = new Float64Array(length);
				const baseLazy = new Uint32Array(length);
				const bit = n - 1 < MAX_LAZY_TOKENS ? 1 << (n - 1) : 0;
				for (let at = 0; at < length; at++) {
					const tail = last.tail[at]!;
					// The finished word's skipped fuzzy score stays unknown until the item could rank.
					base[at] = last.fixed[at]! + (Number.isNaN(tail) ? 0 : tail);
					baseLazy[at] = last.lazy[at]! | (Number.isNaN(tail) ? bit : 0);
				}
				return { candidates: last.survivors, base, baseLazy, pending: [tokens[n]!], prefixLength: 0 };
			}
		}
		return { pending: tokens, prefixLength: 0 };
	}

	private emptyResult(query: PreparedQuery, allowed: Uint8Array | undefined, limit: number): SearchResult {
		const size = this.index.size;
		const ids: number[] = [];
		let total = 0;
		for (let index = 0; index < size; index++) {
			if (allowed && !allowed[index]) continue;
			if (ids.length < limit) ids.push(index);
			total++;
		}
		this.last = undefined;
		return { query, ids: Uint32Array.from(ids), scores: new Float64Array(ids.length), total };
	}

	private scan(
		query: PreparedQuery,
		allowed: Uint8Array | undefined,
		plan: Plan,
		from: number,
		to: number,
		heap: TopK,
		out: Scan,
	): void {
		const { folded } = this.index;
		const boost = this.options.boost;
		const weight = this.options.boostWeight ?? 200;
		const { candidates, base, baseLazy, pending, firsts, ends, prefixLength } = plan;
		const last = pending.length - 1;
		const tailToken = pending[last]!;
		const tokens = query.tokens;
		const multi = tokens.length > 1;
		const maxBoost = boost ? weight : 0;
		const lazyAllowed = tokens.length <= MAX_LAZY_TOKENS;
		let { count } = out;
		outer: for (let at = from; at < to; at++) {
			const id = candidates ? candidates[at]! : at;
			if (!candidates && allowed && !allowed[id]) continue;
			const text = folded[id]!;
			let fixed = base ? base[at]! : 0;
			let lazy = baseLazy ? baseLazy[at]! : 0;
			for (let index = 0; index < last; index++) {
				const score = scoreToken(text, pending[index]!);
				if (score === NO_MATCH) continue outer;
				fixed += score;
			}
			const unknown = popcount(lazy) * FUZZY_CEILING;
			const threshold = heap.threshold();
			const bound = lazyAllowed ? threshold - fixed - unknown - maxBoost : Number.NEGATIVE_INFINITY;
			const scored = scoreTokenHinted(
				text,
				tailToken,
				firsts ? firsts[at]! : FIRST_UNKNOWN,
				ends ? ends[at]! : END_UNKNOWN,
				prefixLength,
				bound,
			);
			if (scored === NO_MATCH) continue;
			const tail = scored === UNSCORED ? Number.NaN : scored;
			// A phrase needs every word as a substring; skip work that cannot lift the item into the top results.
			const phrasePossible = multi && tail >= SUBSTRING_FLOOR && lazy === 0;
			const upper =
				fixed +
				unknown +
				(Number.isNaN(tail) ? FUZZY_CEILING : tail) +
				(phrasePossible ? PHRASE : 0) +
				maxBoost;
			if (!Number.isNaN(tail) && upper >= threshold && lazy !== 0) {
				// Could rank: resolve skipped scores of earlier words now.
				for (let bits = lazy, index = 0; bits; bits >>>= 1, index++) {
					if (bits & 1) fixed += scoreToken(text, tokens[index]!);
				}
				lazy = 0;
			}
			out.survivors[count] = id;
			out.fixed[count] = fixed;
			out.lazy[count] = lazy;
			out.tail[count] = tail;
			out.firsts[count] = tokenFirst;
			out.ends[count] = tokenEnd;
			count++;
			if (Number.isNaN(tail) || lazy !== 0 || upper < threshold) continue;
			let total = fixed + tail;
			if (multi && tail >= SUBSTRING_FLOOR) total += phraseBonus(text, query);
			if (boost) total += boost(id) * weight;
			heap.push(total, id);
		}
		out.count = count;
	}

	private begin(plan: Plan): Scan {
		const length = plan.candidates ? plan.candidates.length : this.index.size;
		this.writing = this.last ? 1 - this.lastBuffer : 0;
		let scan = this.buffers[this.writing];
		if (!scan || scan.survivors.length < length) {
			const capacity = Math.max(length, this.index.size);
			scan = {
				survivors: new Uint32Array(capacity),
				fixed: new Float64Array(capacity),
				lazy: new Uint32Array(capacity),
				tail: new Float64Array(capacity),
				firsts: new Int32Array(capacity),
				ends: new Int32Array(capacity),
				count: 0,
			};
			this.buffers[this.writing] = scan;
		}
		scan.count = 0;
		return scan;
	}

	private finish(
		query: PreparedQuery,
		allowed: Uint8Array | undefined,
		limit: number,
		heap: TopK,
		scan: Scan,
	): SearchResult {
		const { count } = scan;
		const { ids, scores } = heap.sorted();
		const result = { query, ids, scores, total: count };
		this.lastBuffer = this.writing;
		this.last = {
			tokens: query.tokens,
			version: this.index.version,
			allowed,
			survivors: scan.survivors.subarray(0, count),
			fixed: scan.fixed.subarray(0, count),
			lazy: scan.lazy.subarray(0, count),
			tail: scan.tail.subarray(0, count),
			firsts: scan.firsts.subarray(0, count),
			ends: scan.ends.subarray(0, count),
			limit,
			result,
		};
		return result;
	}

	search(raw: string, call: SearchCall = {}): SearchResult {
		this.generation++;
		const query = prepareQuery(raw);
		const limit = call.limit ?? this.options.limit ?? DEFAULT_LIMIT;
		if (query.tokens.length === 0) return this.emptyResult(query, call.allowed, limit);
		const plan = this.plan(query, call.allowed, limit);
		if (plan.reuse) return plan.reuse;
		const out = this.begin(plan);
		const heap = new TopK(limit);
		this.scan(query, call.allowed, plan, 0, plan.candidates ? plan.candidates.length : this.index.size, heap, out);
		return this.finish(query, call.allowed, limit, heap, out);
	}

	/**
	 * Like `search`, but yields to the event loop between slices of large scans so input stays
	 * responsive. Resolves `undefined` when a newer search (sync or async) superseded it.
	 */
	async searchAsync(raw: string, call: SearchCall = {}): Promise<SearchResult | undefined> {
		const generation = ++this.generation;
		const query = prepareQuery(raw);
		const limit = call.limit ?? this.options.limit ?? DEFAULT_LIMIT;
		if (query.tokens.length === 0) return this.emptyResult(query, call.allowed, limit);
		const plan = this.plan(query, call.allowed, limit);
		if (plan.reuse) return plan.reuse;
		const out = this.begin(plan);
		const length = plan.candidates ? plan.candidates.length : this.index.size;
		const slice = this.options.sliceSize ?? DEFAULT_SLICE;
		const heap = new TopK(limit);
		for (let from = 0; from < length; from += slice) {
			this.scan(query, call.allowed, plan, from, Math.min(length, from + slice), heap, out);
			if (from + slice < length) {
				await new Promise<void>((resolve) => setImmediate(resolve));
				if (generation !== this.generation) return undefined;
			}
		}
		if (generation !== this.generation) return undefined;
		return this.finish(query, call.allowed, limit, heap, out);
	}

	/** True when `searchAsync` would yield for this index size. */
	isLarge(): boolean {
		return this.index.size > (this.options.sliceSize ?? DEFAULT_SLICE) * 2;
	}
}
