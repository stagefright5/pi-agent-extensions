import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { cleanOutput, type Job } from "./jobs.ts";
import { LOG_VIEW_INITIAL_BYTES, LOG_VIEW_MAX_LINES, LogLines, LogView, wrapLine } from "./log-view.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
const theme = getThemeByName("dark");
const dir = mkdtempSync(join(tmpdir(), "bg-bash-log-"));

function fakeJob(logPath: string): Job {
	return {
		id: "j1",
		state: "running",
		command: "make build",
		pid: 42,
		exitCode: null,
		logPath,
		elapsedMs: () => 72_000,
	} as unknown as Job;
}

function view(logPath: string, rows = 40) {
	const tui = { terminal: { rows, columns: 120 }, requestRender() {} } as unknown as TUI;
	let back = 0;
	const log = new LogView({
		job: fakeJob(logPath),
		tui,
		theme: () => theme,
		keybindings: new KeybindingsManager(),
		height: () => rows,
		onBack: () => back++,
		onClose() {},
	});
	return { log, back: () => back };
}

test("escape sequences, carriage-return progress, and control characters are cleaned", () => {
	assert.equal(cleanOutput("\x1b[31mred\x1b[0m ok"), "red ok");
	assert.equal(cleanOutput("10%\r50%\r100%\ndone"), "100%\ndone");
	assert.equal(cleanOutput("a\x07b\x1b]8;;http://x\x07link\x1b]8;;\x07"), "ablink");
});

test("wrapLine: ASCII fast path, long lines, and wide characters stay within width", () => {
	const out: string[] = [];
	wrapLine("short", 10, out);
	wrapLine("x".repeat(25), 10, out);
	wrapLine("世界".repeat(8), 10, out);
	assert.deepEqual(out.slice(0, 4), ["short", "x".repeat(10), "x".repeat(10), "x".repeat(5)]);
	for (const row of out) assert.ok(visibleWidth(row) <= 10);
});

test("log lines are read incrementally, keep a partial last line, and stay capped", async () => {
	const path = join(dir, "incremental.log");
	writeFileSync(path, "one\ntwo\nthr");
	const lines = new LogLines(path);
	await lines.load();
	assert.deepEqual(lines.lines, ["one", "two"]);
	assert.equal(lines.pending, "thr");
	appendFileSync(path, "ee\nfour\n");
	await lines.load();
	assert.deepEqual(lines.lines, ["one", "two", "three", "four"]);
	assert.equal(lines.pending, "");
	appendFileSync(path, Array.from({ length: LOG_VIEW_MAX_LINES }, (_, i) => `n${i}`).join("\n") + "\n");
	const trimmed = await lines.load();
	assert.equal(trimmed, true);
	assert.ok(lines.lines.length <= LOG_VIEW_MAX_LINES);
	assert.equal(lines.lines.at(-1), `n${LOG_VIEW_MAX_LINES - 1}`);
	assert.ok(lines.dropped > 0);
});

test("view: follows the end, scrolls back, toggles follow, and goes back on Esc", async () => {
	const path = join(dir, "view.log");
	writeFileSync(path, Array.from({ length: 200 }, (_, i) => `row ${i}`).join("\n") + "\n");
	const { log, back } = view(path, 20);
	await log.refresh();
	let lines = log.render(80).map(plain);
	assert.equal(lines.length, 20);
	for (const line of lines) assert.ok(visibleWidth(line) <= 80);
	assert.match(lines[1]!, /j1 · running 1m12s · pid 42/u);
	assert.ok(
		lines.some((line) => line.trim() === "row 199"),
		"opens at the end",
	);
	appendFileSync(path, "row 200\n");
	await log.refresh();
	assert.ok(
		log
			.render(80)
			.map(plain)
			.some((line) => line.trim() === "row 200"),
		"follows new lines",
	);
	log.handleInput("\x1b[A");
	appendFileSync(path, "row 201\n");
	await log.refresh();
	lines = log.render(80).map(plain);
	assert.ok(!lines.some((line) => line.trim() === "row 201"), "scrolling up stops following");
	assert.match(lines.at(-1)!, /follow off/u);
	log.handleInput("f");
	assert.ok(
		log
			.render(80)
			.map(plain)
			.some((line) => line.trim() === "row 201"),
	);
	log.handleInput("g");
	assert.ok(
		log
			.render(80)
			.map(plain)
			.some((line) => line.trim() === "row 0"),
	);
	log.handleInput("\x1b");
	assert.equal(back(), 1);
});

test("budget: a 50 MB log opens from its last 4 MB and frames stay under 2 ms p95", async () => {
	const path = join(dir, "huge.log");
	const line = "compiling module src/components/widgets/panel.ts with optimisations enabled ........ ok\n";
	const block = line.repeat(Math.ceil((1024 * 1024) / line.length));
	writeFileSync(path, "");
	for (let mb = 0; mb < 50; mb++) appendFileSync(path, block);
	const { log } = view(path, 48);
	await log.refresh();
	assert.ok(log.model.cut, "the start of the file was skipped");
	assert.ok(log.model.lines.length <= LOG_VIEW_MAX_LINES);
	assert.ok(log.model.lines.length * line.length <= LOG_VIEW_INITIAL_BYTES + line.length);
	log.render(160); // first frame wraps the kept lines once
	const samples: number[] = [];
	for (let frame = 0; frame < 300; frame++) {
		if (frame % 10 === 0) {
			appendFileSync(path, line.repeat(20));
			await log.refresh();
		}
		if (frame % 3 === 0) log.handleInput(frame % 2 ? "\x1b[A" : "\x1b[B");
		const started = performance.now();
		log.render(160);
		if (frame >= 20) samples.push(performance.now() - started);
	}
	samples.sort((a, b) => a - b);
	const p95 = samples[Math.floor(samples.length * 0.95)]!;
	assert.ok(p95 < 2, `frame p95 ${p95.toFixed(3)} ms`);
});
