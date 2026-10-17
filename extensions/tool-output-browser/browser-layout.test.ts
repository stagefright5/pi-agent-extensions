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
	assert.ok(
		browser.render(80).some((line) => line.includes(theme.fg("accent", "›"))),
		"selected row marker",
	);
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

test("ranked search with highlights, filter chips, multi-select copy, and opening marked results", async () => {
	const records: ToolOutputRecord[] = [
		{
			...record,
			entryId: "a",
			sequence: 1,
			toolName: "bash",
			output: "npm test passed",
			searchText: "bash\nnpm test passed",
			isError: false,
		},
		{
			...record,
			entryId: "b",
			sequence: 2,
			toolName: "read",
			output: "export const testing = 1",
			searchText: "read\nexport const testing = 1",
			isError: false,
		},
		{
			...record,
			entryId: "c",
			sequence: 3,
			toolName: "bash",
			output: "error: tests failed",
			searchText: "bash\nerror: tests failed",
			isError: true,
		},
	];
	const copied: string[] = [];
	const browser = new ToolOutputBrowser(
		tui,
		() => theme,
		new KeybindingsManager(),
		records,
		"",
		() => {},
		async (text) => void copied.push(text),
	);
	browser.focused = true;
	for (const char of "test") browser.handleInput(char);
	const lines = browser.render(120).map(plain);
	assert.match(lines[0]!, /Tool output +3\/3/u);
	assert.match(lines[2]!, /○ bash {3}○ read {3}○ errors only/u);
	browser.handleInput("\x06");
	browser.handleInput("3");
	assert.match(browser.render(120).map(plain)[0]!, /1\/3/u, "errors only");
	browser.handleInput("\x06");
	browser.handleInput("3");
	browser.handleInput("\t");
	browser.handleInput("\t");
	browser.handleInput("\x19");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(copied.length, 1);
	assert.equal(copied[0]!.split("\n\n").length, 2);
	browser.handleInput("\r");
	const detail = browser.render(120).map(plain).join("\n");
	assert.match(detail, /#\d bash|#\d read/u);
	browser.handleInput("n");
	browser.handleInput("\x1b");
	assert.match(browser.render(120).map(plain)[0]!, /Tool output/u, "Esc returns to the list");
});
