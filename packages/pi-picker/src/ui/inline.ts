import { fold } from "../core/fold.ts";
import { matchRanges, prepareQuery, type MatchRange } from "../core/matcher.ts";
import { renderList, type LegendEntry, type RenderedRow } from "./list.ts";
import type { Palette } from "./palette.ts";

export interface InlineItem {
	label: string;
	description?: string;
}

/** The visible window of a host-owned list (for example Pi's native autocomplete state). */
export interface InlineView {
	items: readonly InlineItem[];
	selectedIndex: number;
	start: number;
	end: number;
}

export interface InlineOptions {
	/** Typed text to highlight in labels and descriptions. */
	query?: string;
	legend?: readonly LegendEntry[];
}

const DEFAULT_LEGEND: readonly LegendEntry[] = [
	{ key: "↑↓", action: "select" },
	{ key: "tab", action: "complete" },
	{ key: "escape", action: "close" },
];

/**
 * A suggestion panel without input of its own. Item rows keep the host's order and count, so the
 * host's hit testing still maps row N to visible item N; a final row shows position and keys.
 */
export function renderInlinePanel(
	view: InlineView,
	width: number,
	inset: number,
	palette: Palette,
	options: InlineOptions = {},
): RenderedRow[] {
	if (view.items.length === 0) {
		return [{ text: " ".repeat(Math.max(0, inset)) + palette.fg("dim", "  No matches"), selected: false }];
	}
	const query = prepareQuery(options.query ?? "");
	const ranges = (text: string): MatchRange[] => {
		if (!query.tokens.length) return [];
		const folded = fold(text);
		return matchRanges(text, folded.text, folded.map, query);
	};
	const visible = view.items.slice(view.start, view.end);
	return renderList(
		visible.map((item) => ({
			primary: item.label,
			primaryRanges: ranges(item.label),
			...(item.description ? { secondary: item.description, secondaryRanges: ranges(item.description) } : {}),
		})),
		view.selectedIndex - view.start,
		width,
		palette,
		{
			inset,
			secondary: "column",
			footer: {
				position: `${view.selectedIndex + 1}/${view.items.length}`,
				legend: options.legend ?? DEFAULT_LEGEND,
			},
		},
	);
}
