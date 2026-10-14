import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { browserFrame } from "./browser-layout.ts";
import { ToolOutputBrowser, type ToolOutputRecord } from "./index.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const theme = getThemeByName("dark");
const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as unknown as TUI;
const record: ToolOutputRecord = {
	entryId: "entry",
	sequence: 1,
	toolCallId: "call",
	toolName: "read",
	arguments: { path: "src/世界.ts" },
	content: [],
	details: { test: true },
	isError: false,
	timestamp: 0,
	output: Array.from({ length: 100 }, (_, i) => `${i} 世界 é 🧊`).join("\n"),
	searchText: "read src/世界.ts",
};

test("open-sided frames fit tiny and wide terminals without vertical rails", () => {
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160]) {
		const frame = browserFrame(width, theme);
		for (const line of [frame.rule(), frame.row("世界 é 🧊".repeat(30), true)]) {
			assert.ok(visibleWidth(line) <= width);
			assert.doesNotMatch(plain(line), /[│╭╰╮╯]/);
		}
	}
});

test("list, filtering, detail tabs, scrolling, back, close and theme refresh still work", () => {
	let closed = false;
	let activeTheme = theme;
	const browser = new ToolOutputBrowser(
		tui,
		() => activeTheme,
		new KeybindingsManager(),
		[record],
		"",
		() => {
			closed = true;
		},
	);
	browser.focused = true;
	assert.ok(browser.render(80).some((line) => line.includes(theme.fg("accent", " ·"))));
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160])
		for (const line of browser.render(width)) assert.ok(visibleWidth(line) <= width);
	browser.handleInput("\r");
	assert.match(browser.render(80).map(plain).join("\n"), /0 世界/);
	browser.handleInput("G");
	assert.match(browser.render(80).map(plain).join("\n"), /99 世界/);
	browser.handleInput("\t");
	assert.match(browser.render(80).map(plain).join("\n"), /src\/世界.ts/);
	browser.handleInput("\t");
	assert.match(browser.render(80).map(plain).join("\n"), /"test": true/);
	activeTheme = getThemeByName("light");
	browser.invalidate();
	for (const width of [0, 1, 2, 10, 40, 80, 120, 160])
		for (const line of browser.render(width)) assert.ok(visibleWidth(line) <= width);
	browser.handleInput("\x1b");
	browser.handleInput("not-found");
	assert.match(browser.render(80).map(plain).join("\n"), /No matching/);
	browser.handleInput("\x03");
	assert.equal(closed, true);
});
