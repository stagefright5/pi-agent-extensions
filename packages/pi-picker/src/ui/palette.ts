import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type ThemeToken = "accent" | "bashMode" | "muted" | "dim" | "userMessageText" | "warning" | "success" | "error";

/**
 * Colors derived from the active theme at render time. The surface reuses the user-message tokens;
 * panels are a shade darker so stacked layers read as separate, and the selected row is tinted
 * toward the accent. Non-truecolor terminals fall back to existing theme tokens.
 */
export interface Palette {
	/** Foreground ANSI for body text. */
	text: string;
	surface: string;
	panel: string;
	selected: string;
	fg: (token: ThemeToken, text: string) => string;
	bold: (text: string) => string;
	/** Matched characters. */
	match: (text: string) => string;
}

/** The color subset labels need; a plain fallback works without a theme. */
export type LabelPalette = Pick<Palette, "fg" | "bold">;

type Rgb = readonly [number, number, number];
const TRUECOLOR = /\[(?:38|48);2;(\d+);(\d+);(\d+)m/u;

function rgb(ansi: string): Rgb | undefined {
	const match = TRUECOLOR.exec(ansi);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	return from.map((value, index) => Math.round(value + (to[index]! - value) * amount)) as unknown as Rgb;
}
const bgAnsi = ([r, g, b]: Rgb) => `\x1b[48;2;${r};${g};${b}m`;

export function paletteFromTheme(theme: Theme): Palette {
	const surface = theme.getBgAnsi("userMessageBg");
	const base = rgb(surface);
	const accent = rgb(theme.getFgAnsi("accent"));
	const darker = base ? mix(base, [0, 0, 0], 0.3) : undefined;
	return {
		text: theme.getFgAnsi("userMessageText"),
		surface,
		panel: darker ? bgAnsi(darker) : theme.getBgAnsi("toolPendingBg"),
		selected: darker && accent ? bgAnsi(mix(darker, accent, 0.18)) : theme.getBgAnsi("selectedBg"),
		fg: (token, text) => theme.fg(token, text),
		bold: (text) => theme.bold(text),
		match: (text) => theme.bg("searchMatchBg", theme.fg("searchMatchText", theme.bold(text))),
	};
}

/** A palette without colors, for tests and non-themed hosts. */
export const plainPalette: Palette = {
	text: "",
	surface: "",
	panel: "",
	selected: "",
	fg: (_token, text) => text,
	bold: (text) => text,
	match: (text) => text,
};

/**
 * Fill a row with one background. Nested foreground/background resets inside the row fall back
 * to the row colors rather than the terminal defaults, so no cell ever shows a default-color hole.
 */
export function paintRow(line: string, width: number, fg: string, bg: string): string {
	const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
	if (!fg && !bg) return padded;
	const body = padded
		.replaceAll("\x1b[0m", `\x1b[0m${fg}${bg}`)
		.replaceAll("\x1b[39m", `\x1b[39m${fg}`)
		.replaceAll("\x1b[49m", `\x1b[49m${bg}`);
	return `${fg}${bg}${body}\x1b[49m\x1b[39m`;
}

/** Truncate at a word boundary with an ellipsis; fall back to a hard cut for one long word. */
export function truncateWords(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(text) <= maxWidth) return text;
	if (maxWidth === 1) return "…";
	// Labels and descriptions are plain text; drop the reset truncateToWidth appends.
	const hard = stripTerminalSequences(truncateToWidth(text, maxWidth - 1, ""));
	const boundary = hard.search(/\s+\S*$/u);
	const cut = boundary > Math.floor(maxWidth / 2) ? hard.slice(0, boundary) : hard;
	return cut.replace(/[\s,.;:·-]+$/u, "") + "…";
}

/** Display key text: `ctrl+y` → `⌃Y`, `enter` → `↵`, `tab` → `⇥`, `escape` → `esc`. */
export function keyLabel(key: string): string {
	const named: Record<string, string> = {
		enter: "↵",
		return: "↵",
		tab: "⇥",
		escape: "esc",
		esc: "esc",
		up: "↑",
		down: "↓",
		left: "←",
		right: "→",
		space: "␣",
		backspace: "⌫",
		delete: "⌦",
		pageup: "PgUp",
		pagedown: "PgDn",
	};
	return key
		.split("+")
		.map((part) => {
			const lower = part.toLowerCase();
			if (lower === "ctrl") return "⌃";
			if (lower === "alt") return "⌥";
			if (lower === "shift") return "⇧";
			if (lower === "super" || lower === "cmd") return "⌘";
			return named[lower] ?? (part.length === 1 ? part.toUpperCase() : part);
		})
		.join("");
}
