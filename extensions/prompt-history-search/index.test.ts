import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters as plain } from "node:util";
import type { TUI } from "@earendil-works/pi-tui";
import {
	createPromptHistoryPicker,
	deletePromptsFromPersistedIndex,
	discoverSessionFiles,
	historyIndexPath,
	loadPromptIndexForSearch,
} from "./index.ts";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
const { getThemeByName } = await import(new URL("modes/interactive/theme/theme.js", host).href);

test("history stays in the selected profile and includes custom session directories after bootstrap", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-history-profile-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "profile");
	try {
		const normalDir = join(root, "profile", "sessions", "project");
		const customDir = join(root, "custom-sessions");
		const laterDir = join(root, "another-custom-directory");
		for (const dir of [normalDir, customDir, laterDir]) await mkdir(dir, { recursive: true });
		for (const [dir, text] of [
			[normalDir, "normal prompt"],
			[customDir, "custom prompt"],
			[laterDir, "later prompt"],
		]) {
			const session = SessionManager.create(root, dir);
			session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
			// Sessions flush after the first assistant entry.
			session.appendMessage({
				role: "assistant",
				content: [],
				api: "openai-responses",
				provider: "openai",
				model: "test",
				stopReason: "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			});
		}
		assert.equal(historyIndexPath(), join(root, "profile", "prompt-history-search", "index.json"));
		assert.equal((await discoverSessionFiles()).length, 1);
		assert.equal((await discoverSessionFiles(customDir)).length, 1);
		const first = await loadPromptIndexForSearch(customDir);
		assert.deepEqual(first.prompts.map((p) => p.text).sort(), ["custom prompt", "normal prompt"]);
		const second = await loadPromptIndexForSearch(laterDir);
		assert.deepEqual(second.prompts.map((p) => p.text).sort(), ["custom prompt", "later prompt", "normal prompt"]);
		assert.equal(JSON.parse(await readFile(historyIndexPath(), "utf8")).prompts.length, 3);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

async function withProfile(t: import("node:test").TestContext) {
	const root = await mkdtemp(join(tmpdir(), "pi-history-delete-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "profile");
	t.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	});
	return root;
}

function writeSession(root: string, dir: string, texts: string[]) {
	const session = SessionManager.create(root, dir);
	for (const text of texts) session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
	session.appendMessage({
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "test",
		stopReason: "stop",
		timestamp: Date.now(),
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});
}

test("deleted prompts stay deleted when sessions are rescanned", async (t) => {
	const root = await withProfile(t);
	const dir = join(root, "profile", "sessions", "project");
	await mkdir(dir, { recursive: true });
	writeSession(root, dir, ["keep me", "delete me"]);
	const first = await loadPromptIndexForSearch(dir);
	const doomed = first.prompts.filter((prompt) => prompt.text === "delete me");
	await deletePromptsFromPersistedIndex(doomed);
	const second = await loadPromptIndexForSearch(dir);
	assert.deepEqual(
		second.prompts.map((prompt) => prompt.text),
		["keep me"],
	);
	const saved = JSON.parse(await readFile(historyIndexPath(), "utf8"));
	assert.equal(saved.version, 1, "index format version unchanged");
	assert.equal(saved.deleted.length, 1);
});

test("history picker: recency ranks equal matches, filters, multi-insert, copy, and confirmed delete", async () => {
	const now = Date.UTC(2026, 9, 17, 12);
	const day = 24 * 60 * 60 * 1000;
	const prompts = [
		{ text: "deploy the cache", timestamp: now - 1000, sessionPath: "/s/current.jsonl", cwd: "/work/alpha" },
		{ text: "/model gpt", timestamp: now - 2 * day, sessionPath: "/s/old.jsonl", cwd: "/work/alpha" },
		{ text: "deploy the cache", timestamp: now - 3 * day, sessionPath: "/s/old.jsonl", cwd: "/work/beta" },
		{ text: "review auth\nlong body", timestamp: now - 20 * day, sessionPath: "/s/older.jsonl", cwd: "/work/beta" },
	];
	let result: string | null | undefined;
	const copied: string[] = [];
	const deleted: string[] = [];
	const picker = createPromptHistoryPicker({
		tui: { terminal: { rows: 30, columns: 120 }, requestRender() {} } as unknown as TUI,
		theme: () => getThemeByName("dark"),
		keybindings: new KeybindingsManager(),
		prompts,
		warnings: 0,
		initialQuery: "",
		cwd: "/work/alpha",
		sessionPath: "/s/current.jsonl",
		now,
		done: (value) => {
			result = value;
		},
		copy: async (text) => void copied.push(text),
		delete: async (items) => void deleted.push(...items.map((item) => item.text)),
	});
	picker.focused = true;
	const typeText = (text: string) => {
		for (const char of text) picker.handleInput(char);
	};
	typeText("deploy");
	assert.deepEqual(
		picker.results.map((prompt) => prompt.cwd),
		["/work/alpha", "/work/beta"],
		"the newer of two identical matches ranks first",
	);
	for (let i = 0; i < 6; i++) picker.handleInput("\x7f");
	// Filters: Ctrl+F then a number; options are numbered in display order.
	picker.handleInput("\x06");
	picker.handleInput("1"); // this project
	assert.deepEqual(
		picker.results.map((prompt) => prompt.text),
		["deploy the cache", "/model gpt"],
	);
	picker.handleInput("\x06");
	picker.handleInput("6"); // commands
	assert.deepEqual(
		picker.results.map((prompt) => prompt.text),
		["/model gpt"],
	);
	picker.handleInput("\x06");
	picker.handleInput("6");
	picker.handleInput("\x06");
	picker.handleInput("1");
	picker.handleInput("\x06");
	picker.handleInput("4"); // 7 days
	assert.equal(picker.results.length, 3);
	picker.handleInput("\x06");
	picker.handleInput("4");
	// Copy and delete apply to marked items.
	picker.handleInput("\t");
	picker.handleInput("\t");
	picker.handleInput("\x19");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(copied, ["deploy the cache\n\n/model gpt"]);
	picker.handleInput("\x04");
	assert.match(plain(picker.render(100).at(-1)!), /Press ⌃D again to delete 2 prompts from history/u);
	picker.handleInput("\x04");
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(deleted, ["deploy the cache", "/model gpt"]);
	assert.equal(picker.results.length, 2);
	// Enter inserts the selected prompt; Alt+R moves to the next match.
	picker.handleInput("\x1br");
	picker.handleInput("\r");
	assert.equal(result, "review auth\nlong body");
});
