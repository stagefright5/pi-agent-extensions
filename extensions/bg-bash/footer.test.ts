import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { TUI } from "@earendil-works/pi-tui";
import { jobGlyph, jobLabel, JobsBrowser } from "./browser.ts";
import { FooterStatus, jobsStatusText } from "./footer.ts";
import { JobManager, OUTPUT_EVENT_MS, type Job } from "./jobs.ts";

const shell = { shell: "/bin/bash", args: ["-c"] };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tag = { fg: (token: string, text: string) => `<${token}>${text}</${token}>` };
const manager = () => new JobManager(mkdtempSync(join(tmpdir(), "bg-bash-footer-")));

/** Start a background job directly, without exercising the tool\'s fixed foreground timer. */
function background(jobs: JobManager, command: string, timeout?: number): Job {
	const job = jobs.start({ command, cwd: process.cwd(), shell, timeout });
	jobs.background(job, "footer");
	return job;
}

test("indicator text: running count, then unfilled circles for unread successes and failures", () => {
	assert.equal(jobsStatusText({ running: 0, unreadOk: 0, unreadFailed: 0 }, tag), undefined);
	assert.equal(jobsStatusText({ running: 2, unreadOk: 0, unreadFailed: 0 }, tag), "<accent>● 2 running</accent>");
	assert.equal(jobsStatusText({ running: 0, unreadOk: 1, unreadFailed: 0 }, tag), "<success>○1</success>");
	assert.equal(jobsStatusText({ running: 0, unreadOk: 0, unreadFailed: 3 }, tag), "<error>○3</error>");
	assert.equal(
		jobsStatusText({ running: 2, unreadOk: 1, unreadFailed: 1 }, tag),
		"<accent>● 2 running</accent><dim> · </dim><success>○1</success> <error>○1</error>",
	);
});

test("budget: a chatty background job causes no footer work and at most one output event per interval", async () => {
	const jobs = manager();
	const calls: (string | undefined)[] = [];
	const footer = new FooterStatus(
		jobs,
		() => tag,
		(text) => calls.push(text),
	);
	let stateEvents = 0;
	let outputEvents = 0;
	jobs.onChange((_job, change) => {
		if (change === "output") return void outputEvents++;
		stateEvents++;
		footer.update();
	});
	const started = Date.now();
	// Tens of thousands of chunks in about a second.
	const job = background(
		jobs,
		"for i in $(seq 1 3); do for j in $(seq 1 4000); do echo line $i $j; done; sleep 0.3; done",
	);
	await job.exited();
	await sleep(OUTPUT_EVENT_MS + 50);
	const elapsed = Date.now() - started;
	assert.ok(job.outputBytes > 100_000);
	assert.equal(stateEvents, 2, "backgrounded, exited");
	assert.deepEqual(
		calls.map((text) => text && plain(text)),
		["<accent>● 1 running</accent>", "<success>○1</success>"],
	);
	assert.ok(
		outputEvents <= Math.ceil(elapsed / OUTPUT_EVENT_MS) + 1,
		`${outputEvents} output events in ${elapsed} ms`,
	);
	footer.update();
	footer.update();
	assert.equal(calls.length, 2, "unchanged text is never re-sent");
	job.markRead();
	assert.equal(calls.at(-1), undefined, "reading the last job clears the status");
	assert.equal(calls.length, 3);
});

function fakeTui() {
	let renders = 0;
	const tui = { terminal: { rows: 30, columns: 140 }, requestRender: () => renders++ } as unknown as TUI;
	return { tui, renders: () => renders };
}

async function browser(jobs: JobManager, tickMs = 40) {
	const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
	const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
	const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);
	const { tui, renders } = fakeTui();
	const sent: string[] = [];
	let closed = 0;
	const view = new JobsBrowser({
		tui,
		theme: () => getThemeByName("dark"),
		keybindings: new KeybindingsManager(),
		manager: jobs,
		done: () => closed++,
		sendToAgent: (text) => sent.push(text),
		copy: async () => {},
		tickMs,
	});
	view.focused = true;
	return { view, renders, sent, closed: () => closed };
}

test("jobs manager: rows, live tail preview, selection reads, tick only while running", async () => {
	const jobs = manager();
	const done = background(jobs, "echo finished-output; exit 2");
	await done.exited();
	const running = background(jobs, "for i in $(seq 1 30); do echo tick $i; sleep 0.05; done");
	const { view, renders } = await browser(jobs);
	assert.equal(jobGlyph(done), "○");
	assert.equal(done.unread, true);
	let lines = view.render(140).map(plain);
	assert.match(lines.join("\n"), /● j2 running \d+s/u);
	assert.match(lines.join("\n"), /○ j1 exit 2 · \d+s/u, "unread failure shows an unfilled circle");
	// The newest job is selected first; its live tail follows new output.
	await sleep(600);
	lines = view.render(140).map(plain);
	const last = lines.find((line) => /tick \d+/u.test(line));
	assert.ok(last, "preview shows the tail");
	const before = renders();
	await sleep(200);
	assert.ok(renders() > before, "running jobs tick and stream preview updates");
	view.handleInput("\x1b[B");
	view.render(140);
	assert.equal(done.unread, false, "selecting a finished job reads it");
	assert.equal(jobGlyph(done), "✗");
	await running.exited();
	await sleep(120);
	const settled = renders();
	await sleep(200);
	assert.equal(renders(), settled, "no timer and no renders once nothing runs");
	assert.match(jobLabel(running), /^exit 0 · \d+s$/u);
	view.dispose();
});

test("jobs manager: output of an unselected job does not redraw; Ctrl+K kills after confirm; Ctrl+S sends", async () => {
	const jobs = manager();
	const quiet = background(jobs, "sleep 30");
	const chatty = background(jobs, "sleep 0.1; for i in $(seq 1 50); do echo chat $i; sleep 0.02; done; sleep 30");
	const { view, renders, sent, closed } = await browser(jobs, 60_000);
	view.handleInput("\x1b[B"); // select `quiet` (j1); `chatty` (j2) keeps writing
	view.render(140);
	const before = renders();
	await sleep(700);
	assert.ok(chatty.outputVersion > 0);
	assert.equal(renders(), before, "unselected output never requests a render");
	view.handleInput("\x0b");
	assert.equal(quiet.state, "running", "first Ctrl+K only asks to confirm");
	view.handleInput("\x0b");
	await quiet.exited();
	assert.equal(quiet.state, "killed");
	assert.equal(quiet.stoppedBy, "user", "a stop from the manager is a user stop (reported to the agent)");
	view.handleInput("\x1b[A");
	view.handleInput("\x13");
	assert.match(sent[0]!, /^Background job j2 \(running \d+s\): sleep 0\.1;/u);
	assert.match(sent[0]!, /\nchat 1\n(?:chat \d+\n)*```$/u);
	assert.equal(closed(), 1);
	chatty.kill();
	await chatty.exited();
	view.dispose();
});
