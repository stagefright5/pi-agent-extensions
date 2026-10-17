import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { excerpt, singleLine } from "../core/highlight.ts";
import type { MatchRange } from "../core/matcher.ts";
import { keyLabel, truncateWords, type Palette } from "./palette.ts";

export interface ListRow {
	primary: string;
	primaryRanges?: readonly MatchRange[];
	secondary?: string;
	secondaryRanges?: readonly MatchRange[];
	marked?: boolean;
}

export interface LegendEntry {
	key: string;
	action: string;
}

export interface ListLayout {
	/** Left/right inset in cells. */
	inset?: number;
	/**
	 * `column`: primary in an aligned name column, secondary after it (menus).
	 * `right`: primary fills the row, secondary is right-aligned metadata (history, logs).
	 */
	secondary?: "column" | "right";
	/** Upper bound for the name column in `column` layout. */
	maxNameWidth?: number;
	/** Show a mark gutter for multi-select. */
	markable?: boolean;
	/** Final row: position on the left, keys on the right. Omitted when undefined. */
	footer?: { position: string; legend: readonly LegendEntry[] };
}

export interface RenderedRow {
	text: string;
	selected: boolean;
	/** True for the footer row (display only). */
	footer?: boolean;
}

/** Fit text to `width` cells, keeping the first match in view and carrying its ranges along. */
function fit(
	text: string,
	ranges: readonly MatchRange[] | undefined,
	width: number,
): { text: string; ranges: readonly MatchRange[] } {
	const line = singleLine(text);
	if (width <= 0) return { text: "", ranges: [] };
	if (visibleWidth(line) <= width) return { text: line, ranges: ranges ?? [] };
	const first = ranges?.[0];
	// Keep a match visible: excerpt around it when a plain cut would hide it.
	if (first) {
		const cut = truncateWords(line, width);
		const kept = cut.endsWith("…") ? cut.length - 1 : cut.length;
		if (first[1] > kept) return excerpt(line, ranges!, width);
		return {
			text: cut,
			ranges: ranges!
				.filter(([start]) => start < kept)
				.map(([start, end]) => [start, Math.min(end, kept)] as const),
		};
	}
	return { text: truncateWords(line, width), ranges: [] };
}

function styled(
	text: string,
	ranges: readonly MatchRange[],
	palette: Palette,
	base?: (text: string) => string,
): string {
	if (!ranges.length) return base ? base(text) : text;
	let out = "";
	let at = 0;
	for (const [start, end] of ranges) {
		if (start > at) out += base ? base(text.slice(at, start)) : text.slice(at, start);
		out += palette.match(text.slice(start, end));
		at = end;
	}
	if (at < text.length) out += base ? base(text.slice(at)) : text.slice(at);
	return out;
}

/**
 * Draw only the given rows (the caller passes the visible window). Every returned row is exactly
 * `width` cells or narrower; the caller paints backgrounds (selected rows use `palette.selected`).
 */
export function renderList(
	rows: readonly ListRow[],
	selected: number,
	width: number,
	palette: Palette,
	layout: ListLayout = {},
): RenderedRow[] {
	const inset = Math.max(0, Math.min(layout.inset ?? 1, Math.floor(width / 4)));
	const gutter = layout.markable ? 3 : 2;
	const lead = " ".repeat(inset);
	const room = Math.max(0, width - inset * 2 - gutter);
	const columnLayout = (layout.secondary ?? "column") === "column";
	const longest = Math.max(0, ...rows.map((row) => visibleWidth(singleLine(row.primary))));
	const nameWidth = columnLayout
		? Math.max(
				1,
				Math.min(Math.max(8, Math.min(longest, layout.maxNameWidth ?? 34, Math.floor(width * 0.4))), room),
			)
		: room;
	const out: RenderedRow[] = rows.map((row, index) => {
		const isSelected = index === selected;
		const marker =
			(isSelected ? palette.fg("accent", "›") : " ") +
			(layout.markable ? (row.marked ? palette.fg("success", "●") : " ") : "") +
			" ";
		let secondaryRoom = 0;
		let primaryWidth = nameWidth;
		const secondary = row.secondary ? singleLine(row.secondary) : "";
		if (!columnLayout && secondary) {
			secondaryRoom = Math.min(visibleWidth(secondary), Math.floor(room * 0.35));
			primaryWidth = Math.max(1, room - secondaryRoom - (secondaryRoom ? 2 : 0));
		}
		const primary = fit(row.primary, row.primaryRanges, primaryWidth);
		const name = isSelected
			? styled(primary.text, primary.ranges, palette, (part) => palette.fg("accent", palette.bold(part)))
			: styled(primary.text, primary.ranges, palette);
		let line = lead + marker + name;
		if (columnLayout) {
			const detailRoom = room - nameWidth - 2;
			if (secondary && detailRoom >= 8) {
				const detail = fit(secondary, row.secondaryRanges, detailRoom);
				const tone = (part: string) => palette.fg(isSelected ? "userMessageText" : "dim", part);
				line +=
					" ".repeat(Math.max(0, nameWidth - visibleWidth(primary.text))) +
					"  " +
					styled(detail.text, detail.ranges, palette, tone);
			}
		} else if (secondaryRoom > 0) {
			const meta = fit(secondary, row.secondaryRanges, secondaryRoom);
			const gap = room - visibleWidth(primary.text) - visibleWidth(meta.text);
			line +=
				" ".repeat(Math.max(2, gap)) +
				styled(meta.text, meta.ranges, palette, (part) => palette.fg("dim", part));
		}
		return { text: line, selected: isSelected };
	});
	if (layout.footer) {
		const { position, legend } = layout.footer;
		const shown = [...legend];
		const plain = () => shown.map((entry) => `${keyLabel(entry.key)} ${entry.action}`).join("  ");
		while (shown.length && inset * 2 + gutter + visibleWidth(position) + 2 + visibleWidth(plain()) > width)
			shown.pop();
		const right = shown
			.map((entry) => palette.fg("muted", keyLabel(entry.key)) + " " + palette.fg("dim", entry.action))
			.join("  ");
		const gap = width - inset * 2 - gutter - visibleWidth(position) - visibleWidth(plain());
		const text =
			lead +
			" ".repeat(gutter) +
			palette.fg("dim", position) +
			(shown.length ? " ".repeat(Math.max(1, gap)) + right : "");
		out.push({ text, selected: false, footer: true });
	}
	for (const row of out) if (visibleWidth(row.text) > width) row.text = truncateToWidth(row.text, width, "");
	return out;
}
