import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { loadThemeFromPath } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const path = fileURLToPath(new URL("./themes/obsidian-ice.json", import.meta.url));
type RGB = [number, number, number];

function hex(value: string): RGB {
	return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as RGB;
}

/** Measure emitted ANSI, including pi's real 256-color quantization, not just source hex. */
function emittedRgb(value: string): RGB {
	const rgb = value.match(/(?:38|48);2;(\d+);(\d+);(\d+)m/u);
	if (rgb) return rgb.slice(1).map(Number) as RGB;
	const indexed = value.match(/(?:38|48);5;(\d+)m/u);
	assert.ok(indexed, `No explicit color in ${JSON.stringify(value)}`);
	const index = Number(indexed[1]);
	// ANSI 0-15 are terminal-configurable: do not pretend their RGB values are fixed.
	assert.ok(index >= 16 && index <= 255, `Terminal-dependent palette index ${index}`);
	if (index >= 232) return [8 + (index - 232) * 10, 8 + (index - 232) * 10, 8 + (index - 232) * 10];
	const cube = [0, 95, 135, 175, 215, 255];
	const n = index - 16;
	return [cube[Math.floor(n / 36)]!, cube[Math.floor(n / 6) % 6]!, cube[n % 6]!];
}

function contrast(a: RGB, b: RGB): number {
	const luminance = (rgb: RGB) => {
		const linear = rgb.map((channel) => {
			const value = channel / 255;
			return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
		return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
	};
	const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
	return (values[1]! + 0.05) / (values[0]! + 0.05);
}

const textRoles = [
	"text",
	"muted",
	"dim",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdQuote",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"searchMatchText",
	"accent",
	"success",
	"warning",
	"error",
];
const panels = [
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"selectedBg",
	"searchMatchBg",
];

for (const mode of ["truecolor", "256color"]) {
	const theme = loadThemeFromPath(path, mode);
	const foreground = (token: string) => emittedRgb(theme.fg(token, "x"));
	const background = (token: string) => emittedRgb(theme.bg(token, "x"));
	// Opaque reference backgrounds only. Window transparency/wallpaper are outside the theme's control.
	const terminal = hex("#0a0f14");
	const exportPage = hex("#111720");
	const check = (label: string, fg: RGB, bg: RGB, minimum: number) => {
		const actual = contrast(fg, bg);
		assert.ok(actual >= minimum, `${mode}: ${label} is ${actual.toFixed(4)}:1, requires ${minimum}:1`);
	};

	test(`${mode}: normal text, syntax, secondary metadata and selection text meet 4.5:1`, () => {
		for (const role of textRoles) {
			for (const panel of panels) check(`${role} on ${panel}`, foreground(role), background(panel), 4.5);
			check(`${role} on configured terminal`, foreground(role), terminal, 4.5);
			check(`${role} on export page`, foreground(role), exportPage, 4.5);
		}
	});

	test(`${mode}: shortcut/shell label color meets 4.5:1 independently of thinking-mode borders`, () => {
		// The editor regression tests separately verify that every mode uses this text token.
		check("muted label on configured terminal", foreground("muted"), terminal, 4.5);
		check("muted label on selected surface", foreground("muted"), background("selectedBg"), 4.5);
	});

	test(`${mode}: meaningful boundaries, focus, mode indicators, scrollbar and selection marker meet 3:1`, () => {
		for (const token of [
			"border",
			"borderAccent",
			"thinkingOff",
			"thinkingMinimal",
			"thinkingLow",
			"thinkingMedium",
			"thinkingHigh",
			"thinkingXhigh",
			"thinkingMax",
			"bashMode",
		]) {
			check(`${token} on configured terminal`, foreground(token), terminal, 3);
			check(`${token} on user panel`, foreground(token), background("userMessageBg"), 3);
		}
		check("scrollbar thumb on track", foreground("scrollbarThumb"), foreground("scrollbarTrack"), 3);
		check("scrollbar thumb on terminal", foreground("scrollbarThumb"), terminal, 3);
		check("selection marker", foreground("accent"), background("selectedBg"), 3);
	});
}
