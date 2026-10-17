import { fold } from "./fold.ts";

/**
 * A search index over items, built once per data set. Text is folded once on insert and kept in
 * parallel arrays, so typing never re-normalizes the haystack. Mutations bump `version`, which
 * invalidates every cached search and filter mask derived from the previous contents.
 */
export class SearchIndex<T> {
	readonly items: T[] = [];
	readonly texts: string[] = [];
	readonly folded: string[] = [];
	readonly maps: (Uint32Array | undefined)[] = [];
	version = 0;

	constructor(
		private readonly toText: (item: T) => string,
		items: Iterable<T> = [],
	) {
		this.add(items);
	}

	get size(): number {
		return this.items.length;
	}

	add(items: Iterable<T>): void {
		for (const item of items) {
			const text = this.toText(item);
			const folded = fold(text);
			this.items.push(item);
			this.texts.push(text);
			this.folded.push(folded.text);
			this.maps.push(folded.map);
		}
		this.version++;
	}

	/** Remove matching items in one compaction pass; returns the number removed. */
	removeWhere(predicate: (item: T, index: number) => boolean): number {
		let kept = 0;
		const length = this.items.length;
		for (let index = 0; index < length; index++) {
			if (predicate(this.items[index]!, index)) continue;
			if (kept !== index) {
				this.items[kept] = this.items[index]!;
				this.texts[kept] = this.texts[index]!;
				this.folded[kept] = this.folded[index]!;
				this.maps[kept] = this.maps[index];
			}
			kept++;
		}
		for (const array of [this.items, this.texts, this.folded, this.maps]) array.length = kept;
		if (kept !== length) this.version++;
		return length - kept;
	}

	/** Replace every item (for example after reloading from disk). */
	replace(items: Iterable<T>): void {
		for (const array of [this.items, this.texts, this.folded, this.maps]) array.length = 0;
		this.add(items);
	}
}
