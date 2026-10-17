import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	discoverAndLoadExtensions,
	ExtensionRunner,
	initTheme,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, TuiMainScreen, type Component, type Terminal } from "@earendil-works/pi-tui";
import { SerialTaskQueue, PlanRepository } from "./plan-store.ts";
import { withLoader, requestRevision } from "./plan-ui.ts";
import { planProgress } from "./index.ts";
import { restorePlanState } from "./state.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const host = new URL(".", import.meta.resolve("@earendil-works/pi-coding-agent"));
const { KeybindingsManager } = await import(new URL("core/keybindings.js", host).href);
initTheme("dark", false);
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "pi-plan-contract-"));
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	const previousGit = process.env.GIT_CONFIG_GLOBAL;
	process.env.HOME = root;
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	const loaded = await discoverAndLoadExtensions(
		[fileURLToPath(new URL("./index.ts", import.meta.url))],
		root,
		join(root, "agent"),
	);
	assert.deepEqual(loaded.errors, []);
	const manager = SessionManager.inMemory(root);
	const models = await ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(root, "models-cache"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, root, manager, new ModelRegistry(models));
	const notifications: string[] = [];
	const userMessages: unknown[] = [];
	const customMessages: unknown[] = [];
	const errors: unknown[] = [];
	const working: boolean[] = [];
	runner.onError((error) => errors.push(error));
	loaded.runtime.getThinkingLevel = () => "off";
	let activeTools = ["read", "bash"];
	loaded.runtime.getActiveTools = () => [...activeTools];
	loaded.runtime.setActiveTools = (names) => {
		activeTools = [...names];
	};
	loaded.runtime.appendEntry = (type, data) => {
		manager.appendCustomEntry(type, data);
	};
	loaded.runtime.sendUserMessage = (content) => {
		userMessages.push(content);
	};
	loaded.runtime.sendMessage = (message) => {
		customMessages.push(message);
	};
	let current: (Component & { dispose?(): void }) | undefined;
	let opens = 0;
	const terminal: Terminal = {
		rows: 30,
		columns: 100,
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
	const baseUI = runner.getUIContext();
	const custom: ExtensionUIContext["custom"] = (factory) =>
		new Promise((resolve, reject) => {
			opens++;
			let component: (Component & { dispose?(): void }) | undefined;
			let completed = false;
			const done = (value) => {
				if (completed) return;
				completed = true;
				component?.dispose?.();
				if (current === component) current = undefined;
				resolve(value);
			};
			Promise.resolve(factory(tui, baseUI.theme, new KeybindingsManager(), done)).then((value) => {
				component = value;
				if (completed) value.dispose?.();
				else {
					current = value;
					value.render(90);
				}
			}, reject);
		});
	runner.setUIContext(
		{
			...baseUI,
			custom,
			notify: (text) => notifications.push(text),
			setStatus() {},
			setWorkingVisible: (value) => working.push(value),
		},
		"tui",
	);
	await runner.emit({ type: "session_start", reason: "startup" });
	const tool = runner.getToolDefinition("plan_output");
	assert.ok(tool);
	const state = () => restorePlanState(manager.getBranch());
	let callId = 0;
	const execute = async (plan = "# Plan\n\nDo the work", signal?: AbortSignal) => {
		const id = `test-${++callId}`;
		const result = await tool.execute(
			id,
			{ title: "Test plan", plan },
			signal,
			undefined,
			runner.createToolContext(id, signal),
		);
		manager.appendMessage({
			role: "toolResult",
			toolCallId: id,
			toolName: "plan_output",
			content: result.content,
			details: result.details,
			isError: false,
			timestamp: Date.now(),
		});
		return result;
	};
	return {
		root,
		activeTools: () => activeTools,
		runner,
		manager,
		tool,
		state,
		execute,
		notifications,
		userMessages,
		customMessages,
		errors,
		working,
		get current() {
			return current;
		},
		get opens() {
			return opens;
		},
		async start() {
			await runner.getCommand("plan").handler("", runner.createCommandContext());
		},
		async settle() {
			await runner.emit({ type: "agent_settled", aborted: false });
			await tick();
		},
		async close() {
			await runner.emit({ type: "session_shutdown", reason: "quit" });
			loaded.runtime.invalidate();
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousGit === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = previousGit;
			await rm(root, { recursive: true, force: true });
		},
	};
}

test("opening and navigating a legacy branch is read-only; new messages migrate once", async () => {
	const f = await fixture();
	try {
		f.manager.appendCustomEntry("plan-mode-interactive", {
			active: true,
			iterations: ["legacy plan"],
			planDir: "/legacy/plans",
			qaMessages: [{ role: "user", content: "old question" }],
		});
		f.manager.appendMessage({ role: "user", content: "old question", timestamp: 1 });
		const before = f.manager.getEntries().length;
		await f.runner.emit({ type: "session_start", reason: "resume" });
		await f.runner.emit({ type: "session_tree", oldLeafId: null, newLeafId: f.manager.getLeafId() });
		assert.equal(f.manager.getEntries().length, before);
		assert.deepEqual(f.state().qaMessages, [{ role: "user", content: "old question" }]);
		const message = { role: "user" as const, content: "new question", timestamp: 2 };
		await f.runner.emit({ type: "message_start", message });
		assert.equal(f.manager.getEntries().length, before + 1);
		f.manager.appendMessage(message);
		assert.deepEqual(
			f.state().qaMessages.map((m) => m.content),
			["old question", "new question"],
		);
		assert.equal(f.state().planDir, "/legacy/plans");
		const after = f.manager.getEntries().length;
		await f.runner.emit({ type: "message_start", message });
		await f.runner.emit({ type: "session_tree", oldLeafId: null, newLeafId: f.manager.getLeafId() });
		assert.equal(f.manager.getEntries().length, after);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("plan tool activation follows mode and preserves unrelated active tools", async () => {
	const f = await fixture();
	try {
		assert.equal(f.tool.defaultActive, false);
		assert.deepEqual(f.activeTools(), ["read", "bash"]);
		await assert.rejects(f.execute(), /Activate plan mode/);
		const blocked = await f.runner.emitToolCall({
			type: "tool_call",
			toolCallId: "blocked",
			toolName: "plan_output",
			input: { title: "x", plan: "x" },
		});
		assert.equal(blocked?.block, true);
		await f.start();
		assert.deepEqual(f.activeTools(), ["read", "bash", "plan_output"]);
		await f.start();
		assert.deepEqual(f.activeTools(), ["read", "bash"]);
	} finally {
		await f.close();
	}
});

test("Q&A messages do not append growing snapshots; plans restore from successful results", async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.execute("large plan ".repeat(10000));
		const before = f.manager
			.getBranch()
			.filter((entry) => entry.type === "custom" && entry.customType === "plan-mode-interactive").length;
		for (let i = 0; i < 25; i++) {
			const message = { role: "user" as const, content: "question " + i, timestamp: Date.now() };
			f.manager.appendMessage(message);
			await f.runner.emit({ type: "message_end", message });
		}
		const states = f.manager
			.getBranch()
			.filter((entry) => entry.type === "custom" && entry.customType === "plan-mode-interactive");
		assert.equal(states.length, before);
		for (const entry of states) {
			assert.equal(entry.data.version, 2);
			assert.equal(entry.data.iterations, undefined);
			assert.equal(entry.data.qaMessages, undefined);
			assert.ok(JSON.stringify(entry.data).length < 1000);
		}
		assert.equal(f.state().iterations.length, 1);
		assert.equal(f.state().qaMessages.length, 25);
		await f.runner.emit({ type: "session_start", reason: "reload" });
		assert.equal(f.state().iterations[0], "large plan ".repeat(10000));
	} finally {
		await f.close();
	}
});

test("plan_output is sequential/model-only; simultaneous calls commit ordered complete iterations", async () => {
	const f = await fixture();
	try {
		await f.start();
		assert.equal(f.tool.executionMode, "sequential");
		assert.equal(f.tool.exposure, "model-only");
		const [first, second] = await Promise.all([f.execute("plan A"), f.execute("plan B")]);
		assert.equal(first.details.iteration, 1);
		assert.equal(second.details.iteration, 2);
		assert.equal(first.terminate, true);
		assert.equal(second.terminate, true);
		assert.deepEqual(f.state().iterations, ["plan A", "plan B"]);
		assert.equal(await readFile(join(second.details.planDir, "plan.md"), "utf8"), "plan B");
		assert.equal(f.opens, 0, "do not open UI from inside tool execution");
		await f.settle();
		assert.equal(f.opens, 1);
		assert.ok(f.current);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("non-TUI, cancellation, and storage errors reject without advancing plan state", async () => {
	const f = await fixture();
	try {
		const ctx = f.runner.createToolContext("test", undefined);
		await assert.rejects(
			f.tool.execute("test", { title: "test", plan: "plan" }, undefined, undefined, { ...ctx, mode: "rpc" }),
			/requires TUI/,
		);
		await f.start();
		const before = structuredClone(f.state());
		await assert.rejects(f.execute("cancelled", AbortSignal.abort()), /abort/i);
		assert.deepEqual(f.state(), before);
		f.manager.appendCustomEntry("plan-mode-interactive", {
			...before,
			planDir: join(f.root, "missing"),
			iterations: ["saved"],
		});
		await f.runner.emit({ type: "session_start", reason: "reload" });
		await assert.rejects(f.execute("never saved"), /ENOENT/);
		assert.deepEqual(f.state().iterations, ["saved"]);
		assert.equal(f.opens, 0);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("error rendering never announces a presentation; narrow result rendering fits", async () => {
	const f = await fixture();
	try {
		const context = {
			args: {},
			state: {},
			cwd: f.root,
			toolCallId: "test",
			invalidate() {},
			executionStarted: true,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: true,
			outputPad: 0,
		};
		const component = f.tool.renderResult(
			{ content: [{ type: "text", text: "Could not save plan" }], details: {} },
			{ expanded: false, isPartial: false },
			f.runner.getUIContext().theme,
			context,
		);
		assert.match(component.render(80).map(stripTerminalSequences).join("\n"), /Could not save plan/);
		assert.doesNotMatch(
			component.render(80).map(stripTerminalSequences).join("\n"),
			/Plan presented|ready for review/,
		);
	} finally {
		await f.close();
	}
});

test("review approval sends the approved plan once; closing only displays it", async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.execute("approved text");
		await f.settle();
		f.current.handleInput("\x1b");
		await tick();
		assert.equal(f.userMessages.length, 0);
		assert.equal(f.customMessages.length, 0, "display-only plans never enter model context");
		assert.equal(
			f.manager
				.getBranch()
				.filter((entry) => entry.type === "custom" && entry.customType === "plan-mode-rendered-plan").length,
			1,
		);
		const reopened = f.runner.getCommand("plan-review").handler("", f.runner.createCommandContext());
		await tick();
		f.current.handleInput("a");
		await reopened;
		assert.equal(f.state().active, false);
		assert.equal(f.userMessages.length, 1);
		assert.match(String(f.userMessages[0]), /I approve this plan[\s\S]*approved text/);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("shutdown closes UI and prevents deferred review or approval from stale contexts", async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.execute();
		await f.settle();
		const oldView = f.current;
		await f.runner.emit({ type: "session_shutdown", reason: "reload" });
		oldView.handleInput("a");
		await tick();
		assert.equal(f.current, undefined);
		assert.equal(f.userMessages.length, 0);
		assert.equal(f.customMessages.length, 0);
		assert.equal(f.working.at(-1), true);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("plan guidance uses structured sections and persisted branch state is immutable", async () => {
	const f = await fixture();
	try {
		await f.start();
		const initial = f.state();
		const firstLeaf = f.manager.getLeafId();
		await f.execute("first iteration");
		const firstState = f.state();
		await f.execute("second iteration");
		assert.deepEqual(initial.iterations, []);
		assert.deepEqual(firstState.iterations, ["first iteration"]);
		const event = await f.runner.emitBeforeAgentStart(
			{ messageType: "user", prompt: "test" },
			{ cwd: f.root, sections: { unrelated: "keep me" } },
		);
		assert.equal(event.systemPromptOptions.sections.unrelated, "keep me");
		assert.match(event.systemPromptOptions.sections.plan_mode, /2 iterations/);
		assert.equal(event.systemPromptOptions.forceSystemPrompt, undefined);
		f.manager.branch(firstLeaf);
		await f.runner.emit({ type: "session_start", reason: "reload" });
		assert.deepEqual(f.state().iterations, []);
		await f.settle();
		assert.equal(f.opens, 0);
	} finally {
		await f.close();
	}
});

test("save queue recovers after failure and exposes pending work", async () => {
	const queue = new SerialTaskQueue();
	const values: number[] = [];
	const a = queue.run(async () => {
		values.push(1);
		throw new Error("expected");
	});
	const b = queue.run(async () => {
		values.push(2);
		return "ok";
	});
	assert.equal(queue.pending, 2);
	await assert.rejects(a, /expected/);
	assert.equal(await b, "ok");
	await queue.idle();
	assert.equal(queue.pending, 0);
	assert.deepEqual(values, [1, 2]);
});

test("repository cleans failed initialization, restores failed edits, and diffs actual iteration text", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-plan-repo-"));
	const run = promisify(execFile);
	let failCommit = false;
	const repository = new PlanRepository(async (command, args, options) => {
		if (failCommit && args.includes("commit"))
			return { stdout: "", stderr: "simulated commit failure", code: 1, killed: false };
		try {
			const result = await run(command, args, {
				signal: options?.signal,
				env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
			});
			return { ...result, code: 0, killed: false };
		} catch (error) {
			if (typeof error.code !== "number") throw error;
			return { stdout: error.stdout, stderr: error.stderr, code: error.code, killed: false };
		}
	}, root);
	try {
		failCommit = true;
		await assert.rejects(repository.save(null, "test", "bad", 1, new AbortController().signal), /simulated/);
		assert.deepEqual(await readdir(root), []);
		failCommit = false;
		const dir = await repository.save(null, "test", "old", 1, new AbortController().signal);
		failCommit = true;
		await assert.rejects(repository.save(dir, "test", "bad", 2, new AbortController().signal), /simulated/);
		assert.equal(await readFile(join(dir, "plan.md"), "utf8"), "old");
		await writeFile(join(dir, "notes.txt"), "unrelated user work");
		await run("git", ["-C", dir, "add", "--", "notes.txt"]);
		failCommit = false;
		await repository.save(dir, "test", "new", 2, new AbortController().signal);
		assert.equal((await run("git", ["-C", dir, "diff", "--cached", "--name-only"])).stdout.trim(), "notes.txt");
		assert.equal(
			(await run("git", ["-C", dir, "show", "--format=", "--name-only", "HEAD"])).stdout.trim(),
			"plan.md",
		);
		assert.equal(await repository.diff("same", "same", new AbortController().signal), "");
		const diff = await repository.diff("left\n", "right\n", new AbortController().signal);
		assert.match(diff, /-left/);
		assert.match(diff, /\+right/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a stale review cannot approve a newer iteration without displaying it", async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.execute("old plan");
		await f.settle();
		const old = f.current;
		await f.execute("new plan");
		await f.settle();
		old.handleInput("a");
		await tick();
		assert.equal(f.userMessages.length, 0);
		assert.equal(f.opens, 2);
		assert.match(f.current.render(90).map(stripTerminalSequences).join("\n"), /new plan/);
		f.current.handleInput("a");
		await tick();
		assert.equal(f.userMessages.length, 1);
		assert.match(String(f.userMessages[0]), /new plan/);
	} finally {
		await f.close();
	}
});

test("revision feedback preserves review state and authorizes exactly a requested revision", async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.execute("first plan");
		await f.settle();
		f.current.handleInput("r");
		await tick();
		for (const character of "add tests") f.current.handleInput(character);
		f.current.handleInput("\r");
		await tick();
		assert.equal(f.state().revisionPending, true);
		assert.match(String(f.userMessages[0]), /Feedback:\nadd tests/);
		await f.execute("revised plan");
		assert.equal(f.state().revisionPending, false);
		const blocked = await f.runner.emitToolCall({
			type: "tool_call",
			toolCallId: "unrequested",
			toolName: "plan_output",
			input: { title: "test", plan: "unrequested replacement" },
		});
		assert.equal(blocked?.block, true);
		assert.equal(blocked?.terminate, true);
	} finally {
		await f.close();
	}
});

test("summary usage survives workflow cancellation and drains before session teardown", async () => {
	for (const reason of ["toggle", "tree", "shutdown"]) {
		const f = await fixture();
		try {
			f.manager.appendCustomEntry("plan-mode-interactive", {
				active: true,
				iterations: ["old plan", "new plan"],
				planDir: "/legacy/plans",
				qaMessages: [],
			});
			await f.runner.emit({ type: "session_start", reason: "resume" });
			let finish!: (value: unknown) => void;
			let requestSignal: AbortSignal | undefined;
			const context = {
				...f.runner.createContext(),
				model: { provider: "test", id: "summary" },
				modelRegistry: {
					streamSimple(_model: unknown, _context: unknown, options: { signal: AbortSignal }) {
						requestSignal = options.signal;
						return {
							result: () =>
								new Promise((resolve) => {
									finish = resolve;
								}),
						};
					},
				},
			};
			const shortcut = [...f.runner.getShortcuts({}).values()].find(
				(s) => s.description === "Show plan change summary",
			);
			assert.ok(shortcut);
			const summary = shortcut.handler(context as never);
			await tick();
			assert.ok(requestSignal);
			let shutdown: Promise<unknown> | undefined;
			if (reason === "toggle") await f.start();
			else if (reason === "tree")
				await f.runner.emit({ type: "session_tree", oldLeafId: null, newLeafId: f.manager.getLeafId() });
			else shutdown = f.runner.emit({ type: "session_shutdown", reason: "reload" });
			await tick();
			assert.equal(requestSignal.aborted, true);
			const usage = { cost: { total: 0.25 } };
			finish({ stopReason: "aborted", content: [], usage });
			await summary;
			await shutdown;
			await tick();
			const entries = f.manager
				.getEntries()
				.filter((entry) => entry.type === "custom" && entry.customType === "extension-model-usage");
			assert.equal(entries.length, 1, reason);
			assert.deepEqual(entries[0].type === "custom" && entries[0].data, { source: "plan-mode-summary", usage });
			assert.equal(f.current, undefined, "no late summary view is opened");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.close();
		}
	}
});

test("summary and feedback cancellation dispose promptly and ignore late completions", async () => {
	const f = await fixture();
	try {
		const lifetime = new AbortController();
		let requestSignal: AbortSignal | undefined;
		let release: (text: string) => void = () => {};
		const promise = withLoader(f.runner.createContext(), "Loading…", lifetime.signal, async (signal) => {
			requestSignal = signal;
			return new Promise<string>((resolve) => {
				release = resolve;
			});
		});
		await tick();
		assert.ok(f.current);
		lifetime.abort();
		assert.equal(await promise, undefined);
		assert.equal(requestSignal?.aborted, true);
		release("late result");
		await tick();
		assert.equal(f.current, undefined);
		const feedbackLifetime = new AbortController();
		const feedback = requestRevision(f.runner.createContext(), feedbackLifetime.signal);
		await tick();
		const oldEditor = f.current;
		feedbackLifetime.abort();
		assert.equal(await feedback, undefined);
		oldEditor.handleInput("\r");
		assert.equal(f.current, undefined);
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

test("a long plan title is cut with an ellipsis without clearing the tool box background", async () => {
	const f = await fixture();
	try {
		const title = "Background Bash extension (bg-bash), revised with a footer status and a much longer tail";
		const call = f.tool.renderCall({ title, plan: "" }, f.runner.getUIContext().theme, {} as never);
		const row = call.render(120)[0]!;
		assert.match(stripTerminalSequences(row), /revised with a footer ?… *$/u);
		// A full reset would also end the background the tool box paints behind this row.
		assert.ok(!row.includes("\u001b[0m"), JSON.stringify(row));
	} finally {
		await f.close();
	}
});

test("while the plan streams in, the call row shows it growing; once complete, only the title", async () => {
	assert.equal(planProgress(undefined), "writing plan…");
	assert.equal(
		planProgress("# Plan\n\n## Outcome\nText\n\n## Validation\nRun"),
		"writing plan · 7 lines · 42 chars · Validation",
	);
	assert.match(planProgress("x".repeat(4150)), /4\.2k chars$/u);
	const f = await fixture();
	try {
		const theme = f.runner.getUIContext().theme;
		const args = { title: "Background Bash", plan: "# Plan\n\n## Phases\n1. One" };
		const streaming = f.tool.renderCall(args, theme, { argsComplete: false } as never).render(100);
		assert.equal(streaming.length, 2);
		assert.match(stripTerminalSequences(streaming[1]!), /^writing plan · 4 lines · .* · Phases/u);
		for (const line of streaming) assert.ok(!line.includes("\u001b[0m"));
		const done = f.tool.renderCall(args, theme, { argsComplete: true } as never).render(100);
		assert.equal(done.length, 1);
	} finally {
		await f.close();
	}
});
