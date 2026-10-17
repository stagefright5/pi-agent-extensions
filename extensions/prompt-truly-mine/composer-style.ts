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
): string {
	const fits = mode !== undefined && inset * 2 + visibleWidth(mode) <= width;
	const left = " ".repeat(Math.min(inset, width)) + (fits ? palette.fg("bashMode", mode) : "");
	const leftWidth = Math.min(inset, width) + (fits ? visibleWidth(mode) : 0);
	const shown = [...hints];
	const plain = () => shown.map((hint) => `${hint.key} ${hint.action}`).join("  ");
	while (shown.length && leftWidth + 2 + visibleWidth(plain()) + inset > width) shown.pop();
	if (!shown.length) return left + " ".repeat(Math.max(0, width - leftWidth));
	const right = shown.map((hint) => palette.fg("muted", hint.key) + " " + palette.fg("dim", hint.action)).join("  ");
	return (
		left + " ".repeat(Math.max(0, width - leftWidth - visibleWidth(plain()) - inset)) + right + " ".repeat(inset)
	);
}

/** Discoverability hints shown on the right of the footer strip unless undo/redo replaces them. */
export const INPUT_HINTS: readonly FooterHint[] = [
	{ key: "/", action: "commands" },
	{ key: "$", action: "skills" },
	{ key: "!", action: "shell" },
	{ key: "@", action: "files" },
];

/** Empty-draft placeholder after the cursor. */
export function renderPlaceholder(width: number, inset: number, cursor: string, palette: LabelPalette): string {
	const prompt = "Ask Pi anything";
	const room = width - inset * 2 - 1;
	const lead = " ".repeat(inset);
	if (room < visibleWidth(prompt)) return lead + cursor + " ".repeat(Math.max(0, room + inset));
	return lead + cursor + palette.fg("dim", prompt) + " ".repeat(room - visibleWidth(prompt)) + lead;
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
