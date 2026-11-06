import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { paletteFromTheme } from "./palette.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { getThemeByName, loadThemeFromPath, setTerminalColors, setThemeInstance, theme } = await import(
	new URL("modes/interactive/theme/theme.js", host).href
);

function checkTokens(active: typeof theme): void {
	const palette = paletteFromTheme(active);
	assert.equal(palette.text, active.getFgAnsi("userMessageText"));
	assert.equal(palette.surface, active.getBgAnsi("userMessageBg"));
	assert.equal(palette.panel, active.getBgAnsi("toolPendingBg"));
	assert.equal(palette.selected, active.getBgAnsi("selectedBg"));
	assert.equal(palette.fg("accent", "label"), active.fg("accent", "label"));
	assert.equal(palette.match("hit"), active.bg("searchMatchBg", active.fg("searchMatchText", active.bold("hit"))));
}

test("light and dark palettes retain semantic backgrounds in truecolor and indexed modes", () => {
	for (const name of ["light", "dark"]) {
		for (const mode of ["truecolor", "256color"]) {
			checkTokens(loadThemeFromPath(fileURLToPath(new URL(`modes/interactive/theme/${name}.json`, host)), mode));
		}
	}
});

test("system palette follows terminal reports, including no colors and a stable theme proxy", (t) => {
	t.after(() => {
		setTerminalColors({});
		setThemeInstance(getThemeByName("dark"));
	});
	for (const colors of [
		{},
		{ foreground: { r: 230, g: 235, b: 240 }, background: { r: 10, g: 15, b: 20 } },
		{ foreground: { r: 30, g: 35, b: 40 }, background: { r: 250, g: 250, b: 250 } },
		{},
	]) {
		setTerminalColors(colors);
		const active = getThemeByName("system");
		assert.ok(active);
		setThemeInstance(active);
		checkTokens(theme);
	}
});
