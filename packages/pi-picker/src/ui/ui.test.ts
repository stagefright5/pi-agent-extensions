import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { renderList } from "./list.ts";
import { plainPalette, keyLabel, truncateWords } from "./palette.ts";
import { createPicker, type PickerAction } from "./picker.ts";
import { renderInlinePanel } from "./inline.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const theme = getThemeByName("dark");
const fakeTui = (rows = 30) => ({ terminal: { rows, columns: 120 }, requestRender() {} }) as unknown as TUI;
const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	enter: "\r",
	esc: "\x1b",
	tab: "\t",
	ctrlF: "\x06",
	ctrlY: "\x19",
	ctrlD: "\x04",
};
const type = (picker: { handleInput(data: string): void }, text: string) => {
	for (const char of text) picker.handleInput(char);
};
const mouse = (type: TuiMouseEvent["type"], y: number, extra: Partial<TuiMouseEvent> = {}): TuiMouseEvent => ({
	type,
	button: "left",
	x: 5,
	y,
	screenX: 5,
	screenY: y,
	width: 100,
	height: 30,
	shift: false,
	alt: false,
	ctrl: false,
	...extra,
});

test("list rows never exceed the width; matches stay visible; marks and selection render", () => {
	const rows = [
		{
			primary: "Refactor the auth module and add tests for the token refresh path",
			primaryRanges: [[48, 53]] as const,
			secondary: "Oct 12 · ~/Work/alpha",
		},
		{ primary: "deploy 世界 cache", secondary: "Oct 11", marked: true },
		{ primary: "", secondary: "" },
	];
	for (const layout of ["right", "column"] as const) {
		for (let width = 1; width <= 200; width += 7) {
			for (const row of renderList(rows, 0, width, plainPalette, {
				secondary: layout,
				markable: true,
				footer: {
					position: "1/3",
					legend: [
						{ key: "enter", action: "insert" },
						{ key: "ctrl+y", action: "copy" },
					],
				},
			})) {
				assert.ok(visibleWidth(row.text) <= width, `${layout}@${width}: ${row.text}`);
			}
		}
	}
	const [first, second] = renderList(rows, 0, 50, plainPalette, { secondary: "right", markable: true });
	assert.match(first!.text, /^ › /u);
	assert.match(first!.text, /token/u, "a cut that would hide the match excerpts around it instead");
	assert.match(second!.text, /^ {2}● deploy/u);
	assert.equal(keyLabel("ctrl+y"), "⌃Y");
	assert.equal(keyLabel("enter"), "↵");
	assert.equal(truncateWords("Clean up stale or unresolved Jira workitems", 24), "Clean up stale or…");
});

test("inline panel keeps host row order, highlights the typed query, and adds a legend row", () => {
	const items = [
		{ label: "model", description: "Select model" },
		{ label: "scoped-models", description: "Enable/disable models" },
	];
	const rows = renderInlinePanel(
		{ items, selectedIndex: 1, start: 0, end: 2 },
		80,
		1,
		{ ...plainPalette, match: (text) => `[${text}]` },
		{ query: "mod" },
	);
	assert.deepEqual(
		rows.map((row) => row.text.trimEnd()),
		[
			"   [mod]el          Select [mod]el",
			" › scoped-[mod]els  Enable/disable [mod]els",
			"   2/2" + rows[2]!.text.slice(6).trimEnd(),
		],
	);
	assert.match(rows[2]!.text, /↑↓ select {2}⇥ complete {2}esc close$/u);
	assert.deepEqual(
		rows.map((row) => row.selected),
		[false, true, false],
	);
	assert.deepEqual(
		renderInlinePanel({ items: [], selectedIndex: 0, start: 0, end: 0 }, 40, 1, plainPalette).map((r) => r.text),
		["   No matches"],
	);
});

type Prompt = { text: string; project: string; age: number };
const prompts: Prompt[] = [
	{ text: "Refactor the auth module", project: "alpha", age: 1 },
	{ text: "Fix the parser tests", project: "beta", age: 2 },
	{ text: "Review auth middleware\nwith a long body that mentions tokens several times", project: "alpha", age: 40 },
	{ text: "Deploy cache layer", project: "beta", age: 3 },
];

function makePicker(
	overrides: { keybindings?: InstanceType<typeof KeybindingsManager>; rows?: number; items?: Prompt[] } = {},
) {
	const log: string[] = [];
	let closed = 0;
	const actions: PickerAction<Prompt>[] = [
		{
			id: "insert",
			label: "insert",
			key: "tui.select.confirm",
			primary: true,
			run: (items, context) => (log.push(`insert:${items.map((i) => i.text).join("|")}`), context.close()),
		},
		{
			id: "copy",
			label: "copy",
			key: "ctrl+y",
			run: (items, context) => (log.push(`copy:${items.length}`), context.notify("Copied")),
		},
		{
			id: "delete",
			label: "delete",
			key: "ctrl+d",
			confirm: (items) => `Press ⌃D again to delete ${items.length}`,
			run: (items, context) => (log.push(`delete:${items.length}`), context.remove(items)),
		},
	];
	const picker = createPicker<Prompt>({
		tui: fakeTui(overrides.rows),
		theme: () => theme,
		keybindings: overrides.keybindings ?? new KeybindingsManager(),
		title: "Prompt history",
		items: overrides.items ?? prompts,
		text: (item) => item.text,
		row: (item) => ({ primary: item.text, secondary: `${item.project} · ${item.age}d` }),
		preview: (item) => item.text,
		filters: [
			{
				id: "project",
				label: "Project",
				options: [{ id: "alpha", label: "alpha", test: (item) => item.project === "alpha" }],
			},
			{
				id: "age",
				label: "Age",
				exclusive: true,
				options: [{ id: "7d", label: "7 days", test: (item) => item.age <= 7 }],
			},
		],
		actions,
		multiSelect: true,
		onClose: () => closed++,
	});
	picker.focused = true;
	return { picker, log, closed: () => closed };
}

test("picker renders exactly within width at 20–200 columns and fixed height", () => {
	const { picker } = makePicker({ rows: 30 });
	for (let width = 20; width <= 200; width += 9) {
		const lines = picker.render(width);
		assert.equal(lines.length, 24, `height @${width}`);
		for (const line of lines) assert.ok(visibleWidth(line) <= width, `width @${width}: ${plain(line)}`);
	}
	const wide = picker.render(140).map(plain);
	assert.match(wide[0]!, /Prompt history +4\/4 $/u);
	assert.ok(
		wide.some((line) => line.includes("│")),
		"side-by-side preview on wide terminals",
	);
	assert.match(wide.at(-1)!, /↵ insert {2}⌃Y copy {2}⌃D delete {2}⇥ mark {2}⌃F filter {2}esc close/u);
});

test("typing ranks multi-word matches; navigation, primary action, copy, confirm-delete, marks", () => {
	const { picker, log } = makePicker();
	type(picker, "auth");
	// Both are word-start matches; the earlier one ranks first.
	assert.deepEqual(
		picker.results.map((item) => item.text.split("\n")[0]),
		["Review auth middleware", "Refactor the auth module"],
	);
	type(picker, " rev");
	assert.deepEqual(
		picker.results.map((item) => item.text.split("\n")[0]),
		["Review auth middleware"],
	);
	for (let i = 0; i < 4; i++) picker.handleInput("\x7f");
	picker.handleInput(KEY.down);
	assert.equal(picker.selectedItem?.text, "Refactor the auth module");
	picker.handleInput(KEY.ctrlY);
	assert.deepEqual(log, ["copy:1"]);
	assert.match(plain(picker.render(100).at(-1)!), /Copied/u);
	picker.handleInput(KEY.ctrlD);
	assert.match(plain(picker.render(100).at(-1)!), /Press ⌃D again to delete 1/u);
	picker.handleInput(KEY.ctrlD);
	assert.deepEqual(log, ["copy:1", "delete:1"]);
	assert.deepEqual(
		picker.results.map((item) => item.text.split("\n")[0]),
		["Review auth middleware"],
	);
	for (let i = 0; i < 4; i++) picker.handleInput("\x7f");
	picker.handleInput(KEY.tab);
	picker.handleInput(KEY.tab);
	assert.match(plain(picker.render(100).at(-1)!), /2 marked/u);
	picker.handleInput(KEY.enter);
	assert.deepEqual(
		log.at(-1),
		"insert:Fix the parser tests|Review auth middleware\nwith a long body that mentions tokens several times",
	);
});

test("Esc steps back through confirmation, marks, then closes; Ctrl+F number toggles filters", () => {
	const { picker, closed } = makePicker();
	picker.handleInput(KEY.tab);
	picker.handleInput(KEY.ctrlD);
	picker.handleInput(KEY.esc);
	assert.equal(closed(), 0);
	assert.match(plain(picker.render(100).at(-1)!), /1 marked/u);
	picker.handleInput(KEY.esc);
	assert.doesNotMatch(plain(picker.render(100).at(-1)!), /marked/u);
	picker.handleInput(KEY.ctrlF);
	assert.match(plain(picker.render(100)[2]!), /filter: press a number +1 ○ alpha +2 ○ 7 days/u);
	picker.handleInput("1");
	assert.deepEqual(
		picker.results.map((item) => item.project),
		["alpha", "alpha"],
	);
	picker.handleInput(KEY.ctrlF);
	picker.handleInput("2");
	assert.deepEqual(
		picker.results.map((item) => item.text),
		["Refactor the auth module"],
	);
	assert.match(plain(picker.render(100)[2]!), /^ ⌃F filter {2}1 ● alpha {3}2 ● 7 days/u);
	picker.handleInput(KEY.esc);
	assert.equal(closed(), 1);
});

test("navigation follows the user's keybindings", () => {
	const keybindings = new KeybindingsManager();
	keybindings.setUserBindings({ "tui.select.down": "ctrl+n", "tui.select.up": "ctrl+p" });
	const { picker } = makePicker({ keybindings });
	picker.handleInput("\x0e"); // ctrl+n
	assert.equal(picker.selectedItem?.text, "Fix the parser tests");
	picker.handleInput("\x10"); // ctrl+p
	assert.equal(picker.selectedItem?.text, "Refactor the auth module");
});

test("mouse: press selects, double-click runs the primary action, wheel moves", () => {
	const { picker, log } = makePicker();
	picker.render(100);
	const top = 4; // title, input, chips, rule
	assert.deepEqual(picker.handleMouse(mouse("press", top + 2)), { handled: true, render: true, focus: true });
	assert.equal(picker.selectedItem?.text.startsWith("Review"), true);
	picker.handleMouse(mouse("wheel", top, { wheelDelta: 1 }));
	assert.equal(picker.selectedItem?.text, "Deploy cache layer");
	picker.handleMouse(mouse("press", top));
	picker.handleMouse(mouse("click", top, { clickCount: 2 }));
	assert.deepEqual(log, ["insert:Refactor the auth module"]);
	assert.equal(picker.handleMouse(mouse("press", 0)), undefined, "title row is not a list row");
});

test("preview opens at the first match and highlights it", () => {
	const body = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\nthe needle is here";
	const { picker } = makePicker({ items: [{ text: body, project: "alpha", age: 1 }] });
	type(picker, "needle");
	const lines = picker.render(140).map(plain);
	assert.ok(
		lines.some((line) => line.includes("the needle is here")),
		"match line is scrolled into view",
	);
});

test("large lists search asynchronously and render a busy marker meanwhile", async () => {
	const items = Array.from({ length: 60_000 }, (_, i) => ({
		text: `entry ${i} ${i % 9 ? "hay" : "needle"}`,
		project: "a",
		age: 1,
	}));
	const { picker } = makePicker({ items });
	type(picker, "needle");
	assert.match(plain(picker.render(100)[0]!), /…/u);
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.match(plain(picker.render(100)[0]!), / 6667\/60000 $/u);
});

test("previewKey re-wraps changed preview text; without it the cached lines stay", () => {
	let body = "first version";
	let version = 1;
	const make = (withKey: boolean) =>
		createPicker<{ id: number }>({
			tui: fakeTui(),
			theme: () => theme,
			keybindings: new KeybindingsManager(),
			title: "Live",
			items: [{ id: 1 }],
			text: () => "job",
			preview: () => body,
			...(withKey ? { previewKey: () => String(version) } : {}),
			actions: [],
			onClose() {},
		});
	const keyed = make(true);
	const unkeyed = make(false);
	assert.ok(
		keyed
			.render(140)
			.map(plain)
			.some((line) => line.includes("first version")),
	);
	assert.ok(
		unkeyed
			.render(140)
			.map(plain)
			.some((line) => line.includes("first version")),
	);
	body = "second version";
	version++;
	assert.ok(
		keyed
			.render(140)
			.map(plain)
			.some((line) => line.includes("second version")),
	);
	assert.ok(
		unkeyed
			.render(140)
			.map(plain)
			.some((line) => line.includes("first version")),
	);
});

test("previewTail opens at the end, follows new lines, and Shift+Up scrolls back", () => {
	let count = 80;
	const body = () => Array.from({ length: count }, (_, i) => `log ${i}`).join("\n");
	const picker = createPicker<{ id: number }>({
		tui: fakeTui(),
		theme: () => theme,
		keybindings: new KeybindingsManager(),
		title: "Live",
		items: [{ id: 1 }],
		text: () => "job",
		preview: body,
		previewKey: () => String(count),
		previewTail: true,
		actions: [],
		onClose() {},
	});
	picker.focused = true;
	const has = (text: string) =>
		picker
			.render(140)
			.map(plain)
			.some((line) => new RegExp(`${text}\\b`).test(line));
	assert.ok(has("log 79") && !has("log 0"));
	count = 90;
	assert.ok(has("log 89"), "follows appended lines");
	for (let i = 0; i < 4; i++) picker.handleInput("\x1b[1;2A");
	assert.ok(!has("log 89"), "scrolled back from the end");
});

test("height: functions still work; PickerHeight caps at a fraction and fits the items", () => {
	const make = (height: Parameters<typeof createPicker<{ id: number }>>[0]["height"], count: number, rows = 40) =>
		createPicker<{ id: number }>({
			tui: fakeTui(rows),
			theme: () => theme,
			keybindings: new KeybindingsManager(),
			title: "Sized",
			items: Array.from({ length: count }, (_, id) => ({ id })),
			text: (item) => `item ${item.id}`,
			height,
			actions: [],
			onClose() {},
		});
	assert.equal(make(() => 17, 3).render(80).length, 17, "function heights are unchanged");
	assert.equal(make(undefined, 3).render(80).length, 32, "default stays 80%");
	assert.equal(make({ max: 0.5 }, 3).render(80).length, 20, "max as a fraction");
	assert.equal(make({ max: 12 }, 3).render(80).length, 12, "max above 1 means rows");
	assert.equal(make({ fit: true, max: 0.5 }, 3).render(80).length, 8, "3 items: chrome + items, at least 8");
	assert.equal(make({ fit: true, max: 0.5, min: 14 }, 3).render(80).length, 14, "min keeps room for a preview");
	assert.equal(make({ fit: true, max: 0.5 }, 11).render(80).length, 15, "11 items + 4 chrome rows");
	assert.equal(make({ fit: true, max: 0.5 }, 500).render(80).length, 20, "never taller than max");
	assert.equal(make({ fit: true, max: 0.5, min: 30 }, 3, 20).render(80).length, 10, "min never exceeds max");
	const typing = make({ fit: true, max: 0.5 }, 11);
	typing.focused = true;
	for (const char of "item 1") typing.handleInput(char);
	assert.equal(typing.render(80).length, 15, "typing never resizes the panel");
});
