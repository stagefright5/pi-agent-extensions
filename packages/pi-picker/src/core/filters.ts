import type { SearchIndex } from "./index.ts";

export interface FilterOption<T> {
	id: string;
	label: string;
	test: (item: T) => boolean;
}

/**
 * Options inside a group combine with OR (or only one may be on when `exclusive`); groups combine
 * with AND. A group with nothing selected does not constrain results.
 */
export interface FilterGroup<T> {
	id: string;
	label: string;
	options: readonly FilterOption<T>[];
	exclusive?: boolean;
}

export interface FilterChip {
	group: string;
	option: string;
	label: string;
	active: boolean;
	/** 1-based shortcut number, in display order. */
	shortcut: number;
}

/**
 * Active filters and the allowed-item mask they produce. The mask is cached per active
 * combination and index version, and the same array instance is returned while neither changes,
 * so the searcher can keep narrowing incrementally.
 */
export class FilterState<T> {
	private readonly active = new Map<string, Set<string>>();
	private readonly cache = new Map<string, Uint8Array>();
	private cacheVersion = -1;

	constructor(
		readonly groups: readonly FilterGroup<T>[],
		private readonly index: SearchIndex<T>,
		initial: Readonly<Record<string, readonly string[]>> = {},
	) {
		for (const [group, options] of Object.entries(initial))
			for (const option of options) this.toggle(group, option);
	}

	isActive(group: string, option: string): boolean {
		return this.active.get(group)?.has(option) ?? false;
	}

	toggle(groupId: string, optionId: string): void {
		const group = this.groups.find((candidate) => candidate.id === groupId);
		if (!group?.options.some((option) => option.id === optionId)) return;
		const selected = this.active.get(groupId) ?? new Set<string>();
		if (selected.has(optionId)) selected.delete(optionId);
		else {
			if (group.exclusive) selected.clear();
			selected.add(optionId);
		}
		if (selected.size) this.active.set(groupId, selected);
		else this.active.delete(groupId);
	}

	/** Every option in display order with its shortcut number. */
	chips(): FilterChip[] {
		const chips: FilterChip[] = [];
		for (const group of this.groups) {
			for (const option of group.options) {
				chips.push({
					group: group.id,
					option: option.id,
					label: option.label,
					active: this.isActive(group.id, option.id),
					shortcut: chips.length + 1,
				});
			}
		}
		return chips;
	}

	private key(): string {
		return [...this.active.entries()]
			.map(([group, options]) => `${group}=${[...options].sort().join(",")}`)
			.sort()
			.join(";");
	}

	/** `undefined` when no filter is active (every item allowed). */
	mask(): Uint8Array | undefined {
		if (this.active.size === 0) return undefined;
		if (this.cacheVersion !== this.index.version) {
			this.cache.clear();
			this.cacheVersion = this.index.version;
		}
		const key = this.key();
		const cached = this.cache.get(key);
		if (cached) return cached;
		const tests = this.groups
			.filter((group) => this.active.has(group.id))
			.map((group) => group.options.filter((option) => this.active.get(group.id)!.has(option.id)));
		const { items } = this.index;
		const mask = new Uint8Array(items.length);
		for (let index = 0; index < items.length; index++) {
			const item = items[index]!;
			mask[index] = tests.every((options) => options.some((option) => option.test(item))) ? 1 : 0;
		}
		this.cache.set(key, mask);
		return mask;
	}
}
