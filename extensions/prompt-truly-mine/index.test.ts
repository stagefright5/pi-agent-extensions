import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CustomEditor,
	createEventBus,
	ExtensionRunner,
	initTheme,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	type ExtensionAPI,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, type Terminal, type AutocompleteProvider } from "@earendil-works/pi-tui";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { loadExtensions } = await import(new URL("core/extensions/loader.js", host).href);
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
initTheme("dark", false);
type Factory = NonNullable<ReturnType<ExtensionUIContext["getEditorComponent"]>>;

async function fixture(t: test.TestContext, mode: "tui" | "rpc" = "tui", withHistory = false) {
	const root = await mkdtemp(join(tmpdir(), "prompt-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const events = createEventBus();
	const slashSubmissions: unknown[] = [];
	events.on("prompt-truly-mine:slash-submit", (data) => {
		slashSubmissions.push(data);
	});
	const paths = [fileURLToPath(new URL("./index.ts", import.meta.url))];
	if (withHistory) paths.unshift(fileURLToPath(new URL("../prompt-history-search/index.ts", import.meta.url)));
	const loaded = await loadExtensions(paths, root, events);
	assert.deepEqual(loaded.errors, []);
	const models = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(root, "models"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const runner = new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		root,
		SessionManager.inMemory(root),
		new ModelRegistry(models),
	);
	const errors: unknown[] = [];
	runner.onError((error) => errors.push(error));
	t.after(async () => {
		await runner.emit({ type: "session_shutdown", reason: "quit" });
		loaded.runtime.invalidate();
		assert.deepEqual(errors, []);
	});
	const commands: ReturnType<ExtensionAPI["getCommands"]> = [
		{
			name: "ask",
			source: "extension",
			sourceInfo: { path: join(root, "ask.ts"), source: "local", scope: "temporary", origin: "top-level" },
		},
		{
			name: "review",
			source: "prompt",
			sourceInfo: { path: join(root, "review.md"), source: "local", scope: "temporary", origin: "top-level" },
		},
		{
			name: "skill:testing",
			source: "skill",
			sourceInfo: { path: join(root, "SKILL.md"), source: "local", scope: "temporary", origin: "top-level" },
		},
	];
	await writeFile(join(root, "review.md"), "---\ndescription: Review\n---\nReview $ARGUMENTS");
	await writeFile(join(root, "SKILL.md"), "---\nname: testing\ndescription: Testing\n---\nTest every boundary.");
	loaded.runtime.getCommands = () => commands;
	const sent: Array<Parameters<ExtensionAPI["sendUserMessage"]>> = [];
	loaded.runtime.sendUserMessage = (...args) => {
		sent.push(args);
	};
	const warnings: string[] = [];
	const wrappers: Array<Parameters<ExtensionUIContext["addAutocompleteProvider"]>[0]> = [];
	const identity = (text: string) => text;
	const editorTheme = {
		borderColor: identity,
		selectList: {
			selectedPrefix: identity,
			selectedText: identity,
			description: identity,
			scrollInfo: identity,
			noMatch: identity,
		},
	};
	const terminal: Terminal = {
		rows: 40,
		columns: 80,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		async drainInput() {},
		write() {},
		moveBy() {},
		hideCursor() {},
		showCursor() {},
		clearLine() {},
		clearFromCursor() {},
		clearScreen() {},
		setTitle() {},
		setProgress() {},
		setProgramStatus() {},
	};
	const tui = new TuiMainScreen(terminal);
	const kb = new KeybindingsManager();
	const previous: Factory = (tui, theme, kb) => new CustomEditor(tui, theme, kb);
	let factory: Factory | undefined = previous;
	let editor: ReturnType<Factory> = previous(tui, editorTheme, kb);
	let installations = 0;
	const ui: ExtensionUIContext = {
		...runner.getUIContext(),
		notify: (text) => warnings.push(text),
		addAutocompleteProvider: (wrap) => {
			wrappers.push(wrap);
		},
		getEditorComponent: () => factory,
		getEditorText: () => editor.getExpandedText?.() ?? editor.getText(),
		setEditorText: (text) => editor.setText(text),
		setEditorComponent: (next) => {
			installations++;
			const raw = editor.getText(); // Mirrors pi 1.2.0's factory transfer.
			factory = next;
			editor = (next ?? previous)(tui, editorTheme, kb);
			editor.setText(raw);
		},
	};
	runner.setUIContext(ui, mode);
	return {
		runner,
		ui,
		previous,
		wrappers,
		warnings,
		sent,
		commands,
		slashSubmissions,
		get editor() {
			return editor;
		},
		get installations() {
			return installations;
		},
	};
}

test("real input runner preserves images and streaming delivery during inline promotion", async (t) => {
	const f = await fixture(t, "rpc");
	const images = [{ type: "image" as const, mimeType: "image/png", data: "image-content" }];
	for (const behavior of [undefined, "steer", "followUp"] as const) {
		const result = await f.runner.emitInput("Please /ask about this", images, "rpc", behavior);
		assert.equal(result.action, "handled");
		assert.deepEqual(f.sent.at(-1), [
			[{ type: "text", text: "/ask Please /ask about this" }, ...images],
			{ ...(behavior ? { deliverAs: behavior } : {}), expandPromptTemplates: true },
		]);
	}
	assert.equal((await f.runner.emitInput("Please /ask about this", images, "extension")).action, "continue");
	assert.equal((await f.runner.emitInput("Open /ask/file.ts", images, "rpc")).action, "continue");
	assert.equal(f.sent.length, 3);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	assert.equal(f.installations, 0);
	assert.equal(f.wrappers.length, 0);
});

test("context references keep the request first, retain images, list resources once, and warn for unreadable ones", async (t) => {
	const f = await fixture(t, "rpc");
	const images = [{ type: "image" as const, mimeType: "image/png", data: "image-content" }];
	const result = await f.runner.emitInput("Use $review $review $testing", images, "rpc");
	assert.equal(result.action, "transform");
	if (result.action !== "transform") return;
	assert.deepEqual(result.images, images);
	assert.ok(result.text.startsWith("Use $review $review $testing\n\n"));
	assert.equal((result.text.match(/Prompt template `\$review`/g) ?? []).length, 1);
	assert.match(result.text, /Skill `\$testing`: \S+/u);
	assert.doesNotMatch(result.text, /Test every boundary/u, "skill bodies are read by the agent, not inlined");
	assert.equal((await f.runner.emitInput(result.text, images, "extension")).action, "continue");
	await rm(f.commands[1]!.sourceInfo.path);
	const partial = await f.runner.emitInput("Use $review $testing", images, "rpc");
	assert.equal(partial.action, "transform");
	assert.match(f.warnings[0]!, /Could not load \/review/);
});

test("$name works at the start; retired /skill: and leading /template are blocked with a hint", async (t) => {
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	const leading = await f.runner.emitInput("$testing check the parser", undefined, "interactive");
	assert.equal(leading.action, "transform", "no resend needed: Pi never expands $name");
	if (leading.action === "transform")
		assert.match(leading.text, /^\$testing check the parser\n\n<!-- pi-extension:inline-context:v2 -->/u);
	for (const [text, hint] of [
		["/skill:testing check the parser", /Skills attach with \$name now\. Try \$testing/u],
		["/review the diff", /Prompt templates attach with \$name now\. Try \$review/u],
	] as const) {
		f.ui.setEditorText("");
		const result = await f.runner.emitInput(text, undefined, "interactive");
		assert.equal(result.action, "handled");
		assert.match(f.warnings.at(-1)!, hint);
		assert.equal(f.ui.getEditorText(), text, "the draft stays for editing");
	}
	assert.deepEqual(f.sent, []);
	assert.equal(
		(await f.runner.emitInput("Mid-prompt /review stays plain text", undefined, "interactive")).action,
		"continue",
	);
});

test("editor installation and restoration retain pasted payloads and are idempotent", async (t) => {
	const f = await fixture(t);
	const payload = "large pasted draft\n".repeat(12);
	f.editor.handleInput?.(`\x1b[200~${payload}\x1b[201~`);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	assert.equal(f.ui.getEditorText(), payload);
	const installed = f.ui.getEditorComponent();
	await f.runner.emit({ type: "session_start", reason: "reload" });
	assert.equal(f.ui.getEditorComponent(), installed);
	assert.equal(f.wrappers.length, 1);
	f.editor.handleInput?.(`\x1b[200~${payload}\x1b[201~`);
	await f.runner.emit({ type: "session_shutdown", reason: "reload" });
	assert.equal(f.ui.getEditorComponent(), f.previous);
	assert.equal(f.ui.getEditorText(), payload + payload);
	await f.runner.emit({ type: "session_shutdown", reason: "quit" });
	assert.equal(f.installations, 2);
});

test("shutdown does not replace an editor installed by another extension", async (t) => {
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	const replacement: Factory = (...args) => f.previous(...args);
	f.ui.setEditorComponent(replacement);
	await f.runner.emit({ type: "session_shutdown", reason: "reload" });
	assert.equal(f.ui.getEditorComponent(), replacement);
});

test("$ selection inserts without submitting, remains undoable, and / menus drop skills and templates", async (t) => {
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	const provider: AutocompleteProvider = {
		async getSuggestions() {
			return {
				prefix: "/",
				items: [
					{ value: "review", label: "review" },
					{ value: "skill:testing", label: "skill:testing" },
					{ value: "settings", label: "settings" },
				],
			};
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
	};
	const wrapped = f.wrappers[0]!(provider);
	const options = { signal: new AbortController().signal, force: false };
	const slash = await wrapped.getSuggestions(["/"], 0, 1, options);
	assert.deepEqual(
		slash?.items.map((item) => item.value),
		["settings"],
		"/ is commands only",
	);
	f.editor.setAutocompleteProvider?.(wrapped);
	const submitted: string[] = [];
	f.editor.onSubmit = (text) => {
		submitted.push(text);
	};
	f.editor.handleInput?.("$");
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.ok(f.editor.isShowingAutocomplete?.(), "$ opens reference completion");
	f.editor.handleInput?.("\r");
	assert.equal(f.editor.getText(), "$testing ");
	assert.deepEqual(submitted, []);
	f.editor.handleInput?.("\x1a");
	assert.equal(f.editor.getText(), "$");
	f.editor.handleInput?.("\x19");
	for (const char of "task") f.editor.handleInput?.(char);
	f.editor.handleInput?.("\r");
	assert.deepEqual(submitted, ["$testing task"]);
});

test("slash submissions persist once before shutdown without becoming conversation messages", async (t) => {
	const profile = await mkdtemp(join(tmpdir(), "slash-history-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = profile;
	try {
		const f = await fixture(t, "tui", true);
		await f.runner.emit({ type: "session_start", reason: "startup" });
		const commands = ["/settings", "/fast on", "/review task", "/skill:testing", "/reload", "/quit"];
		for (const text of commands) {
			f.editor.setText(text);
			// Ordinary extension dispatch also adds to history; don't duplicate recall.
			f.editor.onSubmit = (submitted) => {
				f.editor.addToHistory?.(submitted);
			};
			f.editor.handleInput?.("\r");
			await f.runner.emitInput(text, undefined, "interactive");
		}
		assert.equal(f.slashSubmissions.length, commands.length);
		// Retired /template and /skill: forms are blocked with a hint; commands never reach the model.
		assert.deepEqual(f.sent, []);
		for (const text of [...commands].reverse()) {
			f.editor.handleInput?.("\x1b[A");
			assert.equal(f.editor.getText(), text);
		}
		await f.runner.emit({ type: "session_shutdown", reason: "reload" });
		const saved = JSON.parse(await readFile(join(profile, "prompt-history-search", "index.json"), "utf8"));
		assert.deepEqual(saved.prompts.map((p: { text: string }) => p.text).sort(), [...commands].sort());
		assert.ok(saved.prompts.every((p: { timestamp: number; cwd: string }) => p.timestamp > 0 && p.cwd));
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(profile, { recursive: true, force: true });
	}
});

test("reload and session replacement retain Up/Down history, including slash commands", async (t) => {
	Reflect.deleteProperty(globalThis, Symbol.for("@stagefright5/pi-prompt-truly-mine/history"));
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	for (const text of ["first prompt", "/settings", "/model gpt"]) f.editor.addToHistory?.(text);
	for (const reason of ["reload", "new"] as const) {
		await f.runner.emit({ type: "session_shutdown", reason });
		await f.runner.emit({ type: "session_start", reason: reason === "reload" ? "reload" : "new" });
		const recalled: string[] = [];
		for (let i = 0; i < 3; i++) {
			f.editor.handleInput?.("\x1b[A");
			recalled.push(f.editor.getText());
		}
		assert.deepEqual(recalled, ["/model gpt", "/settings", "first prompt"]);
		f.editor.setText("");
	}
	Reflect.deleteProperty(globalThis, Symbol.for("@stagefright5/pi-prompt-truly-mine/history"));
});

test("a fresh process and reloads recall saved prompts from all projects, newest first", async (t) => {
	const key = Symbol.for("@stagefright5/pi-prompt-truly-mine/history");
	Reflect.deleteProperty(globalThis, key);
	const profile = await mkdtemp(join(tmpdir(), "recall-history-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = profile;
	t.after(async () => {
		Reflect.deleteProperty(globalThis, key);
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(profile, { recursive: true, force: true });
	});
	const now = Date.now();
	const saved = [
		{ text: "older prompt in project B", timestamp: now - 3000, sessionPath: "", cwd: "/b" },
		{ text: "/model gpt", timestamp: now - 2000, sessionPath: "", cwd: "/a" },
		{ text: "older prompt in project B", timestamp: now - 1500, sessionPath: "", cwd: "/b" },
		{ text: "newest prompt in project A", timestamp: now - 1000, sessionPath: "", cwd: "/a" },
	];
	await mkdir(join(profile, "prompt-history-search"), { recursive: true });
	await writeFile(
		join(profile, "prompt-history-search", "index.json"),
		JSON.stringify({ version: 1, updatedAt: now, bootstrappedAt: now, prompts: saved }),
	);
	const f = await fixture(t, "tui", true);
	const recall = (count: number) => {
		const seen: string[] = [];
		for (let i = 0; i < count; i++) {
			f.editor.handleInput?.("\x1b[A");
			seen.push(f.editor.getText());
		}
		f.editor.setText("");
		return seen;
	};
	const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
	await f.runner.emit({ type: "session_start", reason: "startup" });
	await settle();
	assert.deepEqual(recall(4), [
		"newest prompt in project A",
		"older prompt in project B",
		"/model gpt",
		"/model gpt", // Up stops at the oldest entry; duplicates were removed.
	]);
	f.editor.addToHistory?.("typed this run");
	await f.runner.emit({ type: "session_shutdown", reason: "reload" });
	await f.runner.emit({ type: "session_start", reason: "reload" });
	await settle();
	assert.deepEqual(recall(4), [
		"typed this run",
		"newest prompt in project A",
		"older prompt in project B",
		"/model gpt",
	]);
});

test("inline completion preserves native forced paths and initial menus", async (t) => {
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	let nativeCalls = 0;
	const native: AutocompleteProvider = {
		triggerCharacters: ["#"],
		async getSuggestions() {
			nativeCalls++;
			return { items: [{ value: "native", label: "native" }], prefix: "n" };
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
	};
	const provider = f.wrappers[0]!(native);
	const options = { signal: new AbortController().signal, force: false };
	const inline = await provider.getSuggestions(["Use $rev"], 0, 8, options);
	assert.equal(inline?.items[0]?.value, "$review");
	assert.equal((await provider.getSuggestions(["Use /as"], 0, 7, options))?.items[0]?.value, "/ask");
	assert.equal(nativeCalls, 0);
	await provider.getSuggestions(["Use $rev"], 0, 8, { ...options, force: true });
	await provider.getSuggestions(["/rev"], 0, 4, options);
	assert.equal(nativeCalls, 2);
	assert.deepEqual(provider.triggerCharacters, ["#", "$"]);
});
