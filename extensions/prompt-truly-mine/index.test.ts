import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CustomEditor,
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

async function fixture(t: test.TestContext, mode: "tui" | "rpc" = "tui") {
	const root = await mkdtemp(join(tmpdir(), "prompt-contract-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const loaded = await loadExtensions([fileURLToPath(new URL("./index.ts", import.meta.url))], root);
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

test("context bundles retain images, load valid resources once, and warn for unreadable resources", async (t) => {
	const f = await fixture(t, "rpc");
	const images = [{ type: "image" as const, mimeType: "image/png", data: "image-content" }];
	const result = await f.runner.emitInput("Use /review /review /skill:testing", images, "rpc");
	assert.equal(result.action, "transform");
	if (result.action !== "transform") return;
	assert.deepEqual(result.images, images);
	assert.equal((result.text.match(/## Prompt template: review/g) ?? []).length, 1);
	assert.match(result.text, /Test every boundary/);
	assert.ok(result.text.endsWith("Use /review /review /skill:testing"));
	assert.equal((await f.runner.emitInput(result.text, images, "extension")).action, "continue");
	await rm(f.commands[1]!.sourceInfo.path);
	const partial = await f.runner.emitInput("Use /review /skill:testing", images, "rpc");
	assert.equal(partial.action, "transform");
	assert.match(f.warnings[0]!, /Could not load \/review/);
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

test("leading resource selection inserts without submitting and remains undoable", async (t) => {
	const f = await fixture(t);
	await f.runner.emit({ type: "session_start", reason: "startup" });
	const provider: AutocompleteProvider = {
		async getSuggestions() {
			return { prefix: "/", items: [{ value: "review", label: "review" }] };
		},
		applyCompletion() {
			throw new Error("Composable selection must use the wrapper");
		},
	};
	f.editor.setAutocompleteProvider?.(f.wrappers[0]!(provider));
	const submitted: string[] = [];
	f.editor.onSubmit = (text) => {
		submitted.push(text);
	};
	f.editor.handleInput?.("/");
	await new Promise((resolve) => setTimeout(resolve, 30));
	f.editor.handleInput?.("\r");
	assert.equal(f.editor.getText(), "/review ");
	assert.deepEqual(submitted, []);
	f.editor.handleInput?.("\x1a");
	assert.equal(f.editor.getText(), "/");
	f.editor.handleInput?.("\x19");
	f.editor.handleInput?.("task");
	f.editor.handleInput?.("\r");
	assert.deepEqual(submitted, ["/review task"]);
	f.editor.handleInput?.("\x1a");
	assert.equal(f.editor.getText(), "");
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
	const inline = await provider.getSuggestions(["Use /rev"], 0, 8, options);
	assert.equal(inline?.items[0]?.value, "review");
	assert.equal(nativeCalls, 0);
	await provider.getSuggestions(["Use /rev"], 0, 8, { ...options, force: true });
	await provider.getSuggestions(["/rev"], 0, 4, options);
	assert.equal(nativeCalls, 2);
	assert.deepEqual(provider.triggerCharacters, ["#"]);
});
