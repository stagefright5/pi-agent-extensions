/**
 * `pnpm bench:picker` — keystroke, open, and frame budgets on synthetic prompt-like data.
 * Exits non-zero when a p95 exceeds its budget. Not part of `pnpm test` (timing is machine-bound).
 */
import { performance } from "node:perf_hooks";
import { SearchIndex } from "../src/core/index.ts";
import { Searcher } from "../src/core/search.ts";
import { renderBench } from "./render.ts";

const WORDS = (
	"refactor auth module token refresh parser tests composer style review deploy cache session prompt history " +
	"extension skill template fullscreen selection cursor padding autocomplete history search widget picker " +
	"fix bug add remove update rename migrate config settings theme obsidian ice keyboard mouse terminal ghostty " +
	"tmux jenkins build pipeline release changeset publish package workspace vendor bundle import export " +
	"café résumé naïve über coördinate"
).split(" ");
const PATHS = ["src/core/index.ts", "extensions/prompt-truly-mine/index.ts", "packages/pi-picker/src/ui/list.ts"];

let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

function prompt(): string {
	const words = 4 + Math.floor(random() * 40);
	const parts: string[] = [];
	for (let i = 0; i < words; i++) parts.push(random() < 0.06 ? pick(PATHS) : pick(WORDS));
	if (random() < 0.15) parts.unshift(`/${pick(WORDS)}`);
	return parts.join(" ");
}

const QUERIES = [
	"refactor auth",
	"fix parser tests",
	"composer style",
	"src/core",
	"deploy cache release",
	"cafe",
	"tmux ghostty",
	"zzz nothing",
];

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

// Stress data: long prompts from a small vocabulary, so most items fuzzy-match early letters.
const BUDGETS: Record<string, number> = {
	"keystroke 1k": 1,
	"keystroke 10k": 1.5,
	"keystroke 100k": 10,
	"open 10k": 30,
	frame: 2,
};

const results: { name: string; p50: number; p95: number; budget?: number }[] = [];
function record(name: string, samples: number[]) {
	if (samples.length === 0) return;
	results.push({ name, p50: percentile(samples, 50), p95: percentile(samples, 95), budget: BUDGETS[name] });
}

for (const size of [1_000, 10_000, 100_000]) {
	const items = Array.from({ length: size }, prompt);
	const index = new SearchIndex<string>((text) => text, items);
	const recency = (id: number) => 1 - id / size;
	const samples: number[] = [];
	for (let round = 0; round < 6; round++) {
		const searcher = new Searcher(index, { limit: 200, boost: recency });
		for (const query of QUERIES) {
			for (let length = 1; length <= query.length; length++) {
				const started = performance.now();
				searcher.search(query.slice(0, length));
				const elapsed = performance.now() - started;
				if (round > 0) samples.push(elapsed); // round 0 warms the JIT
			}
			searcher.search("");
		}
	}
	record(`keystroke ${size >= 1000 ? `${size / 1000}k` : size}`, samples);
	if (size === 10_000) {
		const opens: number[] = [];
		for (let round = 0; round < 12; round++) {
			const started = performance.now();
			const fresh = new SearchIndex<string>((text) => text, items);
			new Searcher(fresh, { limit: 200 }).search("");
			if (round > 1) opens.push(performance.now() - started);
		}
		record("open 10k", opens);
		record("frame", renderBench(index));
	}
}

let failed = false;
console.log("benchmark            p50 ms    p95 ms   budget");
for (const { name, p50, p95, budget } of results) {
	const over = budget !== undefined && p95 > budget;
	failed ||= over;
	console.log(
		`${name.padEnd(18)} ${p50.toFixed(3).padStart(8)} ${p95.toFixed(3).padStart(9)}   ${budget === undefined ? "-" : `≤ ${budget}`}${over ? "  OVER" : ""}`,
	);
}
process.exitCode = failed ? 1 : 0;
