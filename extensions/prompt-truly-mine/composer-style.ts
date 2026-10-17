import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	paintRow,
	paletteFromTheme,
	renderInlinePanel,
	truncateWords,
	type InlineView,
	type LabelPalette,
	type Palette,
	type RenderedRow,
} from "@stagefright5/pi-picker";

/**
 * Composer palette: the shared picker palette plus the composer's layer names. The draft surface
 * reuses the user-message tokens; the footer strip and suggestion panel use the darker panel shade.
 */
export interface ComposerPalette extends Palette {
	footer: string;
	menu: string;
	menuSelected: string;
}

export function composerPalette(theme: Theme): ComposerPalette {
	const palette = paletteFromTheme(theme);
	return { ...palette, footer: palette.panel, menu: palette.panel, menuSelected: palette.selected };
}

export { paintRow, truncateWords };

/** Replace the first inset cell (a literal space) with the mode rail. Other rows stay untouched. */
export function withRail(line: string, rail: string): string {
	return line.startsWith(" ") ? rail + line.slice(1) : line;
}

/** Pi prefixes extension, prompt, and skill descriptions with a scope tag such as `[u]`. */
export function stripSourceTag(description: string): string {
	return description.replace(/^\[[^\]\n]*\]\s*/u, "");
}

export type MenuView = InlineView;
export type MenuRow = RenderedRow;

/**
 * The suggestion panel: the shared inline panel with Pi's scope tags removed from descriptions and
 * the typed text highlighted. Item rows keep native order and count, so native mouse hit testing
 * still maps row N to visible item N.
 */
export function renderMenuPanel(view: MenuView, width: number, inset: number, palette: Palette, query = ""): MenuRow[] {
	const items = view.items.map((item) =>
		item.description
			? { ...item, description: stripSourceTag(item.description.replace(/\s+/gu, " ").trim()) }
			: item,
	);
	return renderInlinePanel({ ...view, items }, width, inset, palette, { query });
}

export interface FooterHint {
	key: string;
	action: string;
}

/** The darker footer strip: mode on the left, contextual hints on the right, both on the inset. */
export function renderFooter(
	width: number,
	inset: number,
	mode: string | undefined,
	hints: readonly FooterHint[],
	palette: LabelPalette,
	status?: StatusLine,
	center?: string,
): string {
	const fits = mode !== undefined && inset * 2 + visibleWidth(mode) <= width;
	const left = " ".repeat(Math.min(inset, width)) + (fits ? palette.fg("bashMode", mode) : "");
	const leftWidth = Math.min(inset, width) + (fits ? visibleWidth(mode) : 0);
	if (status) {
		// The lent status line fills the strip: <dir> <mode> <hints> · <statuses> … model · context · cost.
		const lead = " ".repeat(Math.min(inset, width));
		const room = width - lead.length - inset;
		const extras = [mode ? palette.fg("bashMode", mode) : "", center ?? styleHints(hints, palette)];
		const line = room > 0 ? status(room, extras) : "";
		return lead + line + " ".repeat(Math.max(0, width - lead.length - visibleWidth(line)));
	}
	const shown = [...hints];
	const plain = () => shown.map((hint) => `${hint.key} ${hint.action}`).join("  ");
	while (shown.length && leftWidth + 2 + visibleWidth(plain()) + inset > width) shown.pop();
	if (!shown.length) return left + " ".repeat(Math.max(0, width - leftWidth));
	const right = styleHints(shown, palette);
	return (
		left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(plain()) - inset)) + right + " ".repeat(inset)
	);
}

/** Render a status line exactly `width` cells wide; `extras` follow the directory, last dropped first. */
export type StatusLine = (width: number, extras?: readonly string[]) => string;

/**
 * Pull every truecolor foreground toward `background` by `amount` (0–1), keeping each hue, so
 * quiet chrome sits closer to its bar while warning and error colours stay distinguishable.
 * Rows without truecolor sequences (256-color themes) are returned unchanged.
 */
export function softenForeground(line: string, background: string, amount: number): string {
	const bg = truecolorAfter(background, BG_TRUECOLOR);
	if (!bg) return line;
	const [first = "", ...rest] = line.split(FG_TRUECOLOR);
	return (
		first +
		rest
			.map((chunk) => {
				const end = chunk.indexOf("m");
				const rgb = truecolorAfter(FG_TRUECOLOR + chunk, FG_TRUECOLOR);
				if (!rgb) return FG_TRUECOLOR + chunk;
				const soft = rgb.map((value, index) => Math.round(value + (bg[index]! - value) * amount));
				return `${FG_TRUECOLOR}${soft.join(";")}${chunk.slice(end)}`;
			})
			.join("")
	);
}

const FG_TRUECOLOR = "\x1b[38;2;";
const BG_TRUECOLOR = "\x1b[48;2;";

/** The `r;g;b` triple of the first truecolor sequence starting with `prefix`, if any. */
export function truecolorAfter(ansi: string, prefix: string): number[] | undefined {
	const start = ansi.indexOf(prefix);
	if (start < 0) return undefined;
	const end = ansi.indexOf("m", start);
	const rgb = ansi
		.slice(start + prefix.length, end < 0 ? undefined : end)
		.split(";")
		.map(Number);
	return end > 0 && rgb.length === 3 && rgb.every((value) => Number.isInteger(value)) ? rgb : undefined;
}

/** How far footer text moves toward the footer colour: low-contrast chrome that stays legible. */
export const FOOTER_TEXT_SOFTENING = 0.4;

function styleHints(hints: readonly FooterHint[], palette: LabelPalette): string {
	return hints.map((hint) => palette.fg("muted", hint.key) + " " + palette.fg("dim", hint.action)).join("  ");
}

/** Discoverability hints, shown right-aligned in the empty draft row. */
export const INPUT_HINTS: readonly FooterHint[] = [
	{ key: "/", action: "commands" },
	{ key: "$", action: "skills" },
	{ key: "!", action: "shell" },
	{ key: "@", action: "files" },
];

/** Empty-draft row: the cursor, then input hints right-aligned (dropped from the end when narrow). */
export function renderPlaceholder(
	width: number,
	inset: number,
	cursor: string,
	palette: LabelPalette,
	hints: readonly FooterHint[] = INPUT_HINTS,
): string {
	const room = width - inset * 2 - 1;
	const lead = " ".repeat(inset);
	const shown = [...hints];
	const plain = () => shown.map((hint) => `${hint.key} ${hint.action}`).join("  ");
	// Keep a clear gap after the cursor so the hints never read as typed text.
	while (shown.length && visibleWidth(plain()) + 4 > room) shown.pop();
	const text = shown.length ? styleHints(shown, palette) : "";
	return lead + cursor + " ".repeat(Math.max(0, room - visibleWidth(plain()))) + text + lead;
}

/** A background color as the matching foreground color, for half-block glyphs. */
export function asForeground(bg: string): string {
	return bg.replace("[48;", "[38;");
}

/**
 * Half-row padding. `▄` paints the lower half of each cell in `color`, `▀` the upper half; the other
 * half shows `background` (the terminal default when omitted). Bars get half a row of padding above
 * and below, so their text sits exactly centred.
 */
export function halfRow(width: number, glyph: "\u2584" | "\u2580", color: string, background = ""): string {
	if (width <= 0) return "";
	return `${background}${asForeground(color)}${glyph.repeat(width)}\x1b[39m${background ? "\x1b[49m" : ""}`;
}
