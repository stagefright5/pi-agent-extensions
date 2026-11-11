import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { TUI } from "@earendil-works/pi-tui";
import { compactRenderers } from "./tool-renderers.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { loadThemeFromPath, setThemeJsonValidator, setThemeInstance, getThemeByName, setTerminalColors } = await import(
	new URL("modes/interactive/theme/theme.js", host).href
);
const { validateThemeJson } = await import(new URL("modes/interactive/theme/theme-schema.js", host).href);
setThemeJsonValidator(validateThemeJson);
const path = fileURLToPath(new URL("./themes/terminal-native.json", import.meta.url));
const panels = ["userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const;
const paintedBackground = /\x1b\[(?:4[0-7]|10[0-7]|48;)[\d;]*m/u;

for (const mode of ["truecolor", "256color"] as const) {
	test(`${mode}: terminal-native validates and uses terminal defaults for every message/tool panel`, () => {
		const theme = loadThemeFromPath(path, mode);
		assert.equal(theme.name, "terminal-native");
		assert.equal(theme.getColorMode(), mode);
		for (const token of panels) {
			assert.equal(theme.getBgAnsi(token), "\x1b[49m");
			assert.doesNotMatch(theme.bg(token, "panel"), paintedBackground);
		}
		assert.equal(theme.getFgAnsi("text"), "\x1b[39m");
		assert.equal(theme.getFgAnsi("userMessageText"), "\x1b[39m");
		assert.notEqual(theme.getFgAnsi("success"), theme.getFgAnsi("error"));
		assert.notEqual(theme.getBgAnsi("selectedBg"), theme.getBgAnsi("userMessageBg"));
	});
}

test("theme contains only terminal defaults and the terminal's 16 configurable ANSI slots", () => {
	const json = JSON.parse(readFileSync(path, "utf8"));
	assert.equal(json.appearance, undefined, "do not pin light/dark appearance");
	assert.equal(json.export, undefined, "do not pin export backgrounds");
	for (const [token, value] of Object.entries(json.colors)) {
		assert.ok(value === "" || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 15), token);
	}
});

test("terminal-default surfaces follow dark and light terminal reports without reloading the theme", (t) => {
	t.after(() => setTerminalColors({}));
	const theme = loadThemeFromPath(path, "truecolor");
	for (const background of [
		{ r: 12, g: 15, b: 18 },
		{ r: 248, g: 246, b: 240 },
	]) {
		setTerminalColors({ background });
		for (const token of panels) {
			assert.deepEqual(theme.colors[token], { kind: "rgb", ...background });
			assert.equal(theme.getBgAnsi(token), "\x1b[49m");
		}
	}
});

test("real user messages and pending/success/error tool shells never paint a panel color", async (t) => {
	const { UserMessageComponent } = await import(new URL("modes/interactive/components/user-message.js", host).href);
	const { ToolExecutionComponent } = await import(
		new URL("modes/interactive/components/tool-execution.js", host).href
	);
	const theme = loadThemeFromPath(path, "truecolor");
	setThemeInstance(theme);
	t.after(() => setThemeInstance(getThemeByName("system")!));
	const user = new UserMessageComponent("User message");
	assert.doesNotMatch(user.render(80).join("\n"), paintedBackground);
	const tui = { requestRender() {} } as unknown as TUI;
	for (const isError of [false, true]) {
		const tool = new ToolExecutionComponent("example", "test", {}, {}, compactRenderers("example"), tui, "/tmp");
		tool.markExecutionStarted();
		assert.doesNotMatch(tool.render(80).join("\n"), paintedBackground);
		tool.updateResult({ content: [{ type: "text", text: "Result" }], isError });
		const output = tool.render(80).join("\n");
		assert.doesNotMatch(output, paintedBackground);
		assert.ok(output.includes(theme.fg(isError ? "error" : "success", isError ? "✕" : "✓")));
		tool.setExpanded(true);
		assert.doesNotMatch(tool.render(80).join("\n"), paintedBackground);
	}
});
