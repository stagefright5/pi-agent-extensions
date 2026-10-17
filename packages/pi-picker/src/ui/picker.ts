import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type KeyId,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { fold } from "../core/fold.ts";
import { FilterState, type FilterGroup } from "../core/filters.ts";
import { SearchIndex } from "../core/index.ts";
import { matchRanges, type MatchRange, type PreparedQuery } from "../core/matcher.ts";
import { Searcher, type SearchResult } from "../core/search.ts";
import { renderList, type LegendEntry, type ListRow } from "./list.ts";
import { keyLabel, paintRow, paletteFromTheme, type Palette } from "./palette.ts";
import { Preview } from "./preview.ts";

/** The subset of Pi's keybindings manager the picker needs. */
export interface PickerKeys {
	matches(data: string, id: string): boolean;
	getKeys?(id: string): string[];
}

export interface PickerContext<T> {
	/** Close the picker. */
	close(): void;
	/** Drop items from the list (for example after deleting them). */
	remove(items: readonly T[]): void;
	/** Show a short message in the footer until the next key. */
	notify(message: string, tone?: "info" | "warning" | "error"): void;
}

export interface PickerAction<T> {
	id: string;
	/** Footer label, for example "copy". */
	label: string;
	/**
	 * A Pi keybinding id (contains a dot, for example `tui.select.confirm`) or a key id understood by
	 * `matchesKey` (for example `ctrl+y`).
	 */
	key: KeyId | `${string}.${string}`;
	/** Also runs on Enter and on double-click. */
	primary?: boolean;
	/** Ask to press the key again first; returns the prompt (for example "Press ⌃D again to delete 3"). */
	confirm?: (items: readonly T[]) => string;
	run(items: readonly T[], context: PickerContext<T>): void | Promise<void>;
}

export interface PickerRow {
	primary: string;
	secondary?: string;
}

export interface PickerOptions<T> {
	tui: TUI;
	theme: () => Theme;
	keybindings: PickerKeys;
	title: string;
	items: readonly T[];
	/** Searchable text. */
	text(item: T): string;
	/** Display columns; defaults to the searchable text. Matches are highlighted in both. */
	row?(item: T): PickerRow;
	/** Full text for the preview pane; omit for no preview. */
	preview?(item: T): string;
	filters?: readonly FilterGroup<T>[];
	initialFilters?: Readonly<Record<string, readonly string[]>>;
	actions: readonly PickerAction<T>[];
	multiSelect?: boolean;
	initialQuery?: string;
	/** 0..1 ranking boost, for example recency. */
	boost?(item: T, index: number): number;
	/** `right`: secondary is right-aligned metadata; `column`: aligned description column. */
	layout?: "right" | "column";
	emptyMessage?: string;
	/** Extra keys that move the selection down (for example `alt+r` for reverse search). */
	nextKeys?: readonly KeyId[];
	/** Footer message shown until the first key (for example load warnings). */
	notice?: { text: string; tone?: "info" | "warning" | "error" };
	/** Total rows to render; defaults to 80% of the terminal height. */
	height?(): number;
	/** Close the host overlay (Esc, or an action calling `context.close()`). */
	onClose(): void;
}

const PAGE_LIMIT = 200;
const SIDE_BY_SIDE_WIDTH = 100;

type Message = { text: string; tone: "info" | "warning" | "error" };

export class Picker<T> implements Component, Focusable {
	private readonly input = new Input();
	private readonly index: SearchIndex<T>;
	private readonly searcher: Searcher<T>;
	private readonly filterState: FilterState<T> | undefined;
	private readonly preview = new Preview();
	private result: SearchResult;
	private limit = PAGE_LIMIT;
	private selected = 0;
	private scroll = 0;
	private previewScroll = 0;
	private readonly marked = new Set<T>();
	private filterChord = false;
	private pending: { action: string; prompt: string } | undefined;
	private message: Message | undefined;
	private busy = false;
	private listTop = 0;
	private listRows = 0;
	private _focused = false;

	constructor(private readonly options: PickerOptions<T>) {
		this.index = new SearchIndex(options.text, options.items);
		const boost = options.boost;
		this.searcher = new Searcher(this.index, {
			limit: PAGE_LIMIT,
			...(boost ? { boost: (id: number) => boost(this.index.items[id]!, id) } : {}),
		});
		this.filterState = options.filters?.length
			? new FilterState(options.filters, this.index, options.initialFilters)
			: undefined;
		this.input.setValue(options.initialQuery ?? "");
		if (options.notice) this.message = { text: options.notice.text, tone: options.notice.tone ?? "info" };
		this.result = this.searcher.search(this.input.getValue(), {
			allowed: this.filterState?.mask(),
			limit: this.limit,
		});
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	/** Current query text. */
	get query(): string {
		return this.input.getValue();
	}

	/** Items in result order (the visible window and beyond, up to the current limit). */
	get results(): T[] {
		return Array.from(this.result.ids, (id) => this.index.items[id]!);
	}

	get selectedItem(): T | undefined {
		const id = this.result.ids[this.selected];
		return id === undefined ? undefined : this.index.items[id];
	}

	private get palette(): Palette {
		return paletteFromTheme(this.options.theme());
	}

	private context(): PickerContext<T> {
		return {
			close: () => this.options.onClose(),
			remove: (items) => {
				const drop = new Set(items);
				this.index.removeWhere((item) => drop.has(item));
				for (const item of items) this.marked.delete(item);
				this.refresh(false);
			},
			notify: (text, tone = "info") => {
				this.message = { text, tone };
				this.options.tui.requestRender();
			},
		};
	}

	private refresh(resetSelection = true): void {
		const allowed = this.filterState?.mask();
		const query = this.input.getValue();
		if (resetSelection) {
			this.selected = 0;
			this.scroll = 0;
			this.previewScroll = 0;
			this.limit = PAGE_LIMIT;
		}
		if (this.searcher.isLarge()) {
			this.busy = true;
			void this.searcher.searchAsync(query, { allowed, limit: this.limit }).then((result) => {
				if (!result) return;
				this.busy = false;
				this.apply(result);
				this.options.tui.requestRender();
			});
			return;
		}
		this.apply(this.searcher.search(query, { allowed, limit: this.limit }));
	}

	private apply(result: SearchResult): void {
		this.result = result;
		this.selected = Math.max(0, Math.min(this.selected, result.ids.length - 1));
	}

	private move(delta: number): void {
		if (this.result.ids.length === 0) return;
		this.selected = Math.max(0, Math.min(this.result.ids.length - 1, this.selected + delta));
		this.previewScroll = 0;
		// Fetch more ranked results when the selection nears the end of the current window.
		if (this.selected >= this.result.ids.length - 10 && this.result.total > this.result.ids.length) {
			this.limit *= 2;
			this.refresh(false);
		}
	}

	private matchesKey(data: string, key: PickerAction<T>["key"]): boolean {
		return key.includes(".") ? this.options.keybindings.matches(data, key) : matchesKey(data, key as KeyId);
	}

	private keyText(key: string): string {
		if (!key.includes(".")) return keyLabel(key);
		const bound = this.options.keybindings.getKeys?.(key)[0];
		return bound ? keyLabel(bound) : key;
	}

	private targets(): T[] {
		if (this.marked.size) return [...this.marked];
		const item = this.selectedItem;
		return item === undefined ? [] : [item];
	}

	private runAction(action: PickerAction<T>): void {
		const items = this.targets();
		if (items.length === 0) return;
		if (action.confirm && this.pending?.action !== action.id) {
			this.pending = { action: action.id, prompt: action.confirm(items) };
			this.options.tui.requestRender();
			return;
		}
		this.pending = undefined;
		const context = this.context();
		const report = (error: unknown) =>
			context.notify(error instanceof Error ? error.message : String(error), "error");
		try {
			const running = action.run(items, context);
			if (running instanceof Promise) running.catch(report).finally(() => this.options.tui.requestRender());
		} catch (error) {
			report(error);
		}
		this.options.tui.requestRender();
	}

	handleInput(data: string): void {
		this.message = undefined;
		const kb = this.options.keybindings;

		if (this.filterChord && this.filterState) {
			this.filterChord = false;
			const digit = /^[1-9]$/u.test(data) ? Number(data) : 0;
			const chip = this.filterState.chips().find((candidate) => candidate.shortcut === digit);
			if (chip) {
				this.filterState.toggle(chip.group, chip.option);
				this.refresh();
			}
			this.options.tui.requestRender();
			return;
		}

		if (kb.matches(data, "tui.select.cancel")) {
			// Esc steps back: pending confirmation, then marks, then the picker itself.
			if (this.pending) this.pending = undefined;
			else if (this.marked.size) this.marked.clear();
			else this.options.onClose();
			this.options.tui.requestRender();
			return;
		}

		for (const action of this.options.actions) {
			const confirmKey = action.primary && kb.matches(data, "tui.select.confirm");
			if (confirmKey || this.matchesKey(data, action.key)) {
				this.runAction(action);
				return;
			}
		}
		if (this.pending) {
			this.pending = undefined;
		}

		if (kb.matches(data, "tui.select.up")) this.move(-1);
		else if (kb.matches(data, "tui.select.down") || this.options.nextKeys?.some((key) => matchesKey(data, key)))
			this.move(1);
		else if (kb.matches(data, "tui.select.pageUp")) this.move(-Math.max(1, this.listRows - 1));
		else if (kb.matches(data, "tui.select.pageDown")) this.move(Math.max(1, this.listRows - 1));
		else if (matchesKey(data, "shift+up")) this.previewScroll = Math.max(0, this.previewScroll - 3);
		else if (matchesKey(data, "shift+down")) this.previewScroll += 3;
		else if (this.options.multiSelect && matchesKey(data, "tab")) {
			const item = this.selectedItem;
			if (item !== undefined) {
				if (this.marked.has(item)) this.marked.delete(item);
				else this.marked.add(item);
				this.move(1);
			}
		} else if (this.filterState && matchesKey(data, "ctrl+f")) this.filterChord = true;
		else {
			const before = this.input.getValue();
			this.input.handleInput(data);
			if (this.input.getValue() !== before) this.refresh();
		}
		this.options.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.move(event.wheelDelta < 0 ? -1 : 1);
			return { handled: true, render: true };
		}
		const row = event.y - this.listTop;
		if (row < 0 || row >= this.listRows || event.button !== "left") return undefined;
		const target = this.scroll + row;
		if (target >= this.result.ids.length) return { handled: true };
		if (event.type === "press") {
			this.selected = target;
			this.previewScroll = 0;
			return { handled: true, render: true, focus: true };
		}
		if (event.type === "click" && (event.clickCount ?? 1) >= 2) {
			const primary = this.options.actions.find((action) => action.primary);
			if (primary) this.runAction(primary);
			return { handled: true, render: true };
		}
		return { handled: true };
	}

	private rowFor(id: number, query: PreparedQuery): ListRow {
		const item = this.index.items[id]!;
		const row = this.options.row?.(item) ?? { primary: this.index.texts[id]! };
		const ranges = (text: string): MatchRange[] => {
			if (!query.tokens.length) return [];
			const folded = fold(text);
			return matchRanges(text, folded.text, folded.map, query);
		};
		return {
			primary: row.primary,
			primaryRanges: ranges(row.primary),
			...(row.secondary === undefined
				? {}
				: { secondary: row.secondary, secondaryRanges: ranges(row.secondary) }),
			marked: this.marked.has(item),
		};
	}

	private legend(): LegendEntry[] {
		const entries: LegendEntry[] = this.options.actions.map((action) => ({
			key: action.primary ? "enter" : action.key,
			action: action.label,
		}));
		if (this.options.multiSelect) entries.push({ key: "tab", action: "mark" });
		if (this.filterState) entries.push({ key: "ctrl+f", action: "filter" });
		entries.push({ key: "escape", action: "close" });
		return entries.map((entry) => ({
			key: entry.key.includes(".") ? this.keyText(entry.key) : entry.key,
			action: entry.action,
		}));
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const palette = this.palette;
		const height = Math.max(8, this.options.height?.() ?? Math.floor(this.options.tui.terminal.rows * 0.8));
		const panel = (line: string) => paintRow(truncateToWidth(line, width, ""), width, palette.text, palette.panel);
		const lines: string[] = [];

		const count = `${this.result.total}/${this.index.size}${this.busy ? " …" : ""}`;
		const title = palette.fg("accent", palette.bold(this.options.title));
		const titleGap = width - 2 - visibleWidth(this.options.title) - visibleWidth(count);
		lines.push(panel(" " + title + " ".repeat(Math.max(1, titleGap)) + palette.fg("dim", count)));
		// pi-tui's Input draws its own "> " prompt.
		const inputLine = this.input.render(Math.max(1, width - 2))[0] ?? "";
		lines.push(panel(" " + inputLine));
		if (this.filterState) {
			const chips = this.filterState.chips().map((chip) => {
				const mark = chip.active ? palette.fg("accent", "●") : palette.fg("dim", "○");
				const label = chip.active ? palette.fg("userMessageText", chip.label) : palette.fg("dim", chip.label);
				// The digit is always shown so the row explains itself: ⌃F, then the number, toggles it.
				const digit = palette.fg(this.filterChord ? "warning" : "dim", `${chip.shortcut}`);
				return digit + " " + mark + " " + label;
			});
			const lead = this.filterChord
				? palette.fg("warning", "filter: press a number  ")
				: palette.fg("muted", "⌃F") + palette.fg("dim", " filter  ");
			lines.push(panel(" " + lead + chips.join("   ")));
		}
		lines.push(panel(" " + palette.fg("dim", "─".repeat(Math.max(0, width - 2)))));

		const bodyHeight = Math.max(1, height - lines.length - 1);
		const item = this.selectedItem;
		const previewText = item !== undefined ? this.options.preview?.(item) : undefined;
		const sideBySide = previewText !== undefined && width >= SIDE_BY_SIDE_WIDTH;
		const stacked = previewText !== undefined && !sideBySide && bodyHeight >= 12;
		const listWidth = sideBySide ? Math.floor(width * 0.55) : width;
		this.listRows = stacked ? Math.ceil(bodyHeight * 0.55) : bodyHeight;
		this.listTop = lines.length;

		// Keep the selection in view.
		if (this.selected < this.scroll) this.scroll = this.selected;
		if (this.selected >= this.scroll + this.listRows) this.scroll = this.selected - this.listRows + 1;
		const ids = this.result.ids.subarray(this.scroll, this.scroll + this.listRows);
		const query = this.result.query;
		const rendered = renderList(
			Array.from(ids, (id) => this.rowFor(id, query)),
			this.selected - this.scroll,
			listWidth,
			palette,
			{ inset: 1, secondary: this.options.layout ?? "right", markable: this.options.multiSelect === true },
		);
		const listLines = rendered.map((row) =>
			paintRow(row.text, listWidth, palette.text, row.selected ? palette.selected : palette.panel),
		);
		if (ids.length === 0) {
			const empty = this.index.size === 0 ? "Nothing here yet" : (this.options.emptyMessage ?? "No matches");
			listLines.push(paintRow("   " + palette.fg("dim", empty), listWidth, palette.text, palette.panel));
		}
		while (listLines.length < this.listRows) listLines.push(paintRow("", listWidth, palette.text, palette.panel));

		if (sideBySide || stacked) {
			const previewWidth = sideBySide ? width - listWidth - 3 : width - 2;
			const previewHeight = sideBySide ? this.listRows : bodyHeight - this.listRows - 1;
			const key = `${this.result.ids[this.selected]}\u0000${query.phrase}`;
			const previewRanges = query.tokens.length
				? (() => {
						const folded = fold(previewText!);
						return matchRanges(previewText!, folded.text, folded.map, query);
					})()
				: [];
			const { lines: all, firstMatch } = this.preview.lines(
				key,
				previewText!,
				previewRanges,
				Math.max(1, previewWidth),
				palette,
			);
			// Open the preview at the first match.
			if (this.previewScroll === 0 && firstMatch > previewHeight - 2)
				this.previewScroll = Math.max(0, firstMatch - 2);
			this.previewScroll = Math.max(0, Math.min(this.previewScroll, Math.max(0, all.length - previewHeight)));
			const visible = all.slice(this.previewScroll, this.previewScroll + previewHeight);
			while (visible.length < previewHeight) visible.push("");
			if (sideBySide) {
				for (let row = 0; row < this.listRows; row++) {
					lines.push(
						listLines[row]! +
							paintRow(
								" " + palette.fg("dim", "│") + " " + (visible[row] ?? ""),
								width - listWidth,
								palette.text,
								palette.panel,
							),
					);
				}
			} else {
				lines.push(...listLines);
				lines.push(panel(" " + palette.fg("dim", "─".repeat(Math.max(0, width - 2)))));
				for (const line of visible) lines.push(panel(" " + line));
			}
		} else {
			lines.push(...listLines);
		}

		lines.push(panel(this.footer(width, palette)));
		return lines.map((line) => (visibleWidth(line) > width ? truncateToWidth(line, width, "") : line));
	}

	private footer(width: number, palette: Palette): string {
		const status = this.pending
			? palette.fg("warning", this.pending.prompt)
			: this.message
				? palette.fg(this.message.tone === "info" ? "success" : this.message.tone, this.message.text)
				: undefined;
		const right = this.marked.size ? palette.fg("accent", `${this.marked.size} marked`) : "";
		if (status)
			return (
				" " + status + " ".repeat(Math.max(1, width - 2 - visibleWidth(status) - visibleWidth(right))) + right
			);
		const entries = this.legend();
		const shown = [...entries];
		const plain = () => shown.map((entry) => `${keyLabel(entry.key)} ${entry.action}`).join("  ");
		while (shown.length > 1 && 2 + visibleWidth(plain()) + visibleWidth(right) + 2 > width)
			shown.splice(shown.length - 2, 1);
		const legend = shown
			.map((entry) => palette.fg("muted", keyLabel(entry.key)) + " " + palette.fg("dim", entry.action))
			.join("  ");
		return " " + legend + " ".repeat(Math.max(1, width - 2 - visibleWidth(plain()) - visibleWidth(right))) + right;
	}
}

export function createPicker<T>(options: PickerOptions<T>): Picker<T> {
	return new Picker(options);
}
