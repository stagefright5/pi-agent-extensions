import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fold, toOriginalRange } from "./fold.ts";
import { SearchIndex } from "./index.ts";
import { matchRanges, NO_MATCH, prepareQuery, scoreText } from "./matcher.ts";
import { Searcher } from "./search.ts";
import { FilterState } from "./filters.ts";
import { applyRanges, excerpt, singleLine } from "./highlight.ts";

const score = (text: string, query: string) => scoreText(fold(text).text, prepareQuery(query));
const ranges = (text: string, query: string) => {
	const folded = fold(text);
	return matchRanges(text, folded.text, folded.map, prepareQuery(query));
};
const marked = (text: string, query: string) => applyRanges(text, ranges(text, query), (part) => `[${part}]`);

test("folding ignores case and accents and maps offsets back to the original", () => {
	assert.deepEqual(fold("Hello"), { text: "hello" });
	const cafe = fold("Café Crème");
	assert.equal(cafe.text, "cafe creme");
	assert.deepEqual(toOriginalRange("Café Crème", cafe.map, 5, 10), [5, 10]);
	const decomposed = "Cafe\u0301!";
	const folded = fold(decomposed);
	assert.equal(folded.text, "cafe!");
	assert.deepEqual(toOriginalRange(decomposed, folded.map, 3, 4), [3, 4]);
	assert.deepEqual(toOriginalRange(decomposed, folded.map, 4, 5), [5, 6], "combining mark skipped");
	const emoji = fold("🧊 Ice");
	assert.equal(emoji.text, "🧊 ice");
	assert.equal(score("Crème brûlée", "creme brulee") > 0, true);
	assert.equal(marked("Crème brûlée", "brulee"), "Crème [brûlée]");
});

test("every word must match, in any order", () => {
	assert.ok(score("refactor the auth module", "auth refactor") > 0);
	assert.equal(score("refactor the auth module", "auth payment"), NO_MATCH);
	assert.equal(score("anything", ""), 0);
});

test("ranking: word start > mid-word substring > fuzzy; phrase bonus; earlier wins ties", () => {
	const start = score("fix the parser bug", "pars");
	const middle = score("fix the sparse bug", "pars");
	const fuzzy = score("fix the pan-arrays bug", "pars");
	assert.ok(start > middle, "word start beats mid-word");
	assert.ok(middle > fuzzy, "substring beats fuzzy");
	assert.ok(fuzzy > 0);
	assert.ok(score("path/to/review.md", "rev") > score("prereview notes", "rev"), "after / is a word start");
	assert.ok(score("add auth tests", "auth tests") > score("tests for auth", "auth tests"), "phrase bonus");
	assert.ok(
		score("src/composer.ts", "cmp") > score("xcxmxpx", "cmp"),
		"word-start and consecutive fuzzy letters win",
	);
	assert.equal(score("abc", "abd"), NO_MATCH);
});

test("match ranges cover every exact occurrence, or the tightest fuzzy runs", () => {
	assert.equal(marked("auth tests for auth", "auth"), "[auth] tests for [auth]");
	assert.equal(marked("Refactor Auth Module", "auth mod"), "Refactor [Auth] [Mod]ule");
	assert.equal(marked("xx composer-style.ts", "cmpsty"), "xx [c]o[mp]oser-[sty]le.ts");
	assert.equal(marked("a ab abc", "abc"), "a ab [abc]");
	assert.deepEqual(ranges("nothing", "zzz"), []);
});

function brute(items: string[], query: string, limit: number) {
	const prepared = prepareQuery(query);
	return items
		.map((text, index) => ({ index, score: scoreText(fold(text).text, prepared) }))
		.filter((entry) => entry.score !== NO_MATCH)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.map((entry) => entry.index);
}

test("searcher matches a brute-force ranking while narrowing incrementally", () => {
	const words = ["auth", "parser", "refactor", "token", "review", "composer", "tests", "café", "deploy", "cache"];
	let seed = 7;
	const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
	const items = Array.from({ length: 3000 }, () =>
		Array.from({ length: 3 + Math.floor(random() * 6) }, () => words[Math.floor(random() * words.length)]).join(
			" ",
		),
	);
	const index = new SearchIndex<string>((text) => text, items);
	const searcher = new Searcher(index, { limit: 50 });
	for (const typed of ["r", "re", "ref", "refa", "refac", "refac t", "refac to", "refac tok"]) {
		const result = searcher.search(typed);
		assert.deepEqual([...result.ids], brute(items, typed, 50), typed);
		assert.equal(result.total, brute(items, typed, items.length).length, `${typed} total`);
	}
	// Unrelated queries and deletions start over and stay correct.
	for (const typed of ["cafe", "caf", "deploy cache", "zzz", ""]) {
		const result = searcher.search(typed);
		if (typed) assert.deepEqual([...result.ids], brute(items, typed, 50), typed);
		else
			assert.deepEqual(
				[...result.ids],
				items.slice(0, 50).map((_, i) => i),
			);
	}
});

test("index mutations and filter changes invalidate narrowing", () => {
	const index = new SearchIndex<{ text: string; kind: string }>(
		(item) => item.text,
		[
			{ text: "alpha one", kind: "a" },
			{ text: "alpha two", kind: "b" },
		],
	);
	const searcher = new Searcher(index);
	assert.equal(searcher.search("alp").total, 2);
	index.add([{ text: "alpha three", kind: "a" }]);
	assert.equal(searcher.search("alph").total, 3, "new items are seen after add");
	const state = new FilterState(
		[{ id: "kind", label: "Kind", options: [{ id: "a", label: "A", test: (item) => item.kind === "a" }] }],
		index,
	);
	assert.equal(state.mask(), undefined);
	state.toggle("kind", "a");
	const mask = state.mask()!;
	assert.equal(state.mask(), mask, "same instance while unchanged");
	assert.deepEqual([...searcher.search("alpha", { allowed: mask }).ids], [0, 2]);
	assert.equal(
		index.removeWhere((item) => item.text === "alpha one"),
		1,
	);
	assert.notEqual(state.mask(), mask, "mask rebuilt after mutation");
	assert.deepEqual([...searcher.search("alpha", { allowed: state.mask() }).ids], [1]);
});

test("filter groups: OR within a group, AND across groups, exclusive groups switch", () => {
	type Item = { project: string; age: number };
	const items: Item[] = [
		{ project: "a", age: 1 },
		{ project: "b", age: 1 },
		{ project: "a", age: 10 },
	];
	const index = new SearchIndex<Item>((item) => item.project, items);
	const state = new FilterState(
		[
			{
				id: "project",
				label: "Project",
				options: [
					{ id: "a", label: "A", test: (item) => item.project === "a" },
					{ id: "b", label: "B", test: (item) => item.project === "b" },
				],
			},
			{
				id: "age",
				label: "Age",
				exclusive: true,
				options: [
					{ id: "new", label: "New", test: (item) => item.age < 5 },
					{ id: "old", label: "Old", test: (item) => item.age >= 5 },
				],
			},
		],
		index,
		{ project: ["a"] },
	);
	assert.deepEqual([...state.mask()!], [1, 0, 1]);
	state.toggle("project", "b");
	assert.deepEqual([...state.mask()!], [1, 1, 1]);
	state.toggle("age", "new");
	assert.deepEqual([...state.mask()!], [1, 1, 0]);
	state.toggle("age", "old");
	assert.deepEqual([...state.mask()!], [0, 0, 1], "exclusive option replaced");
	assert.deepEqual(
		state.chips().map((chip) => [chip.shortcut, chip.label, chip.active]),
		[
			[1, "A", true],
			[2, "B", true],
			[3, "New", false],
			[4, "Old", true],
		],
	);
});

test("boost breaks near-ties without overriding a much better match", () => {
	const items = ["deploy the app", "deploy the app", "deployment notes about the app"];
	const index = new SearchIndex<string>((text) => text, items);
	const recency = [0, 1, 0];
	const searcher = new Searcher(index, { boost: (i) => recency[i]!, boostWeight: 50 });
	assert.deepEqual([...searcher.search("deploy app").ids], [1, 0, 2]);
});

test("async search yields on large sets, and a newer search supersedes it", async () => {
	const items = Array.from({ length: 60_000 }, (_, i) => `item ${i} ${i % 7 === 0 ? "needle" : "hay"}`);
	const index = new SearchIndex<string>((text) => text, items);
	const searcher = new Searcher(index, { limit: 10, sliceSize: 10_000 });
	assert.equal(searcher.isLarge(), true);
	const stale = searcher.searchAsync("needle");
	const fresh = searcher.searchAsync("needle 7");
	assert.equal(await stale, undefined);
	const result = (await fresh)!;
	assert.equal(result.total, brute(items, "needle 7", items.length).length);
	assert.deepEqual([...result.ids], brute(items, "needle 7", 10));
});

test("excerpts keep the first match in view, never split wide characters, and shift ranges", () => {
	const text = "The quick brown fox jumps over the lazy dog near the riverbank at dawn";
	const found = ranges(text, "riverbank");
	const view = excerpt(text, found, 30);
	assert.ok(visibleWidth(view.text) <= 30);
	assert.ok(view.text.startsWith("…"));
	assert.equal(applyRanges(view.text, view.ranges, (part) => `[${part}]`).includes("[riverbank]"), true);
	const wide = "世界".repeat(20) + " target " + "世界".repeat(20);
	const wideView = excerpt(wide, ranges(wide, "target"), 21);
	assert.ok(visibleWidth(wideView.text) <= 21);
	assert.ok(wideView.text.includes("target"));
	assert.deepEqual(excerpt("short", [], 10), { text: "short", ranges: [] });
	assert.equal(singleLine("a\tb\nc"), "a b c");
	for (let width = 1; width <= 40; width++) assert.ok(visibleWidth(excerpt(text, found, width).text) <= width);
});
