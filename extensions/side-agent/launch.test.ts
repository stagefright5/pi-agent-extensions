import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	childCommand,
	compareModel,
	compareTools,
	currentPiCommand,
	inheritArgs,
	inheritEnv,
	LAUNCH_FLAG,
	launchConfig,
	toolInventory,
} from "./launch.ts";

test("only supported options are reconstructed, with relative paths made absolute", (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "side-launch-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	writeFileSync(join(cwd, "extra.md"), "be brief");
	const { args, blockers, dropped } = inheritArgs(
		[
			"-e",
			"./ext dir",
			"--extension=builtin:mcp",
			"--skill",
			"/abs/skill",
			"--append-system-prompt",
			"extra.md",
			"--append-system-prompt",
			"Literal text",
			"--tools",
			"+codemode,-write",
			"-ne",
			"--no-mcp",
			"--model",
			"sonnet:high",
			"--thinking",
			"high",
			"--session",
			"/old.jsonl",
			"-c",
			"--print",
			"--plan",
			"-n",
			"name",
			"-a",
			"--theme",
			"t.json",
			"hello world",
			"--",
			"--tools",
			"ignored",
		],
		cwd,
	);
	assert.deepEqual(blockers, []);
	assert.deepEqual(args, [
		"--extension",
		join(cwd, "ext dir"),
		"--extension",
		"builtin:mcp",
		"--skill",
		"/abs/skill",
		"--append-system-prompt",
		join(cwd, "extra.md"),
		"--append-system-prompt",
		"Literal text",
		"--tools",
		"+codemode,-write",
		"--no-extensions",
		"--no-mcp",
		"--theme",
		join(cwd, "t.json"),
	]);
	for (const flag of ["--model", "--thinking", "--session", "-c", "--print", "--plan", "-n", "-a"])
		assert.ok(dropped.includes(flag), flag);
});

test("an ephemeral --api-key blocks launching; it is never forwarded", () => {
	const inherited = inheritArgs(["--model", "x", "--api-key", "sk-secret"], "/");
	assert.equal(inherited.blockers.length, 1);
	assert.ok(!JSON.stringify(inherited.args).includes("sk-secret"));
	assert.equal(inheritArgs(["--api-key=sk-secret"], "/").blockers.length, 1);
});

test("child command: explicit env layer, exact session path, trust decision and launch token", () => {
	const { config } = launchConfig({
		argv: ["--offline"],
		cwd: "/",
		env: {
			PI_CODING_AGENT_DIR: "/agent dir",
			PI_SESSION_ID: "parent",
			REX_BLOCK: "block:parent",
			ANTHROPIC_API_KEY: "sk-secret",
			PI_OFFLINE: "1",
		},
		trusted: false,
	});
	assert.deepEqual(config.env, { PI_CODING_AGENT_DIR: "/agent dir", PI_OFFLINE: "1" });
	const command = childCommand({ pi: ["/node", "/pi/cli.js"], sessionFile: "/s/a b.jsonl", token: "tok", config });
	assert.equal(command[0], "/usr/bin/env");
	for (const name of ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_MODEL"])
		assert.equal(command[command.indexOf(name) - 1], "-u");
	assert.ok(command.includes("PI_CODING_AGENT_DIR=/agent dir"));
	assert.ok(!command.join(" ").includes("sk-secret") && !command.join(" ").includes("block:parent"));
	assert.deepEqual(command.slice(command.indexOf("/node"), command.indexOf("/node") + 4), [
		"/node",
		"/pi/cli.js",
		"--session",
		"/s/a b.jsonl",
	]);
	assert.ok(command.includes("--no-approve") && !command.includes("--approve"));
	assert.deepEqual(command.slice(-2), [`--${LAUNCH_FLAG}`, "tok"]);
	assert.deepEqual(inheritEnv({ HOME: "/h", OPENAI_API_KEY: "x" }), {});
});

test("the same Pi installation is reused, without debugger flags", () => {
	const script = new URL(import.meta.url).pathname;
	assert.deepEqual(
		currentPiCommand({ execPath: "/node", execArgv: ["--inspect=9229", "--no-warnings"], argv: ["/node", script] }),
		["/node", "--no-warnings", script],
	);
	assert.deepEqual(
		currentPiCommand({ execPath: "/pi-binary", execArgv: [], argv: ["/pi-binary", "/$bunfs/root/pi"] }),
		["/pi-binary"],
	);
});

test("tool validation covers active, codemode-callable and configured tools", () => {
	const all = [
		{ name: "read", exposure: "direct" },
		{ name: "bash", exposure: "direct" },
		{ name: "codemode", exposure: "direct" },
		{ name: "mcp__x__y", exposure: "codemode" },
		{ name: "plan_output", exposure: "model-only" },
	];
	const parent = toolInventory(all, ["read", "bash", "codemode"]);
	assert.deepEqual(parent.callable, ["bash", "codemode", "mcp__x__y", "read"]);
	assert.deepEqual(compareTools(parent, parent, "fork"), []);

	const reduced = toolInventory(
		all.filter((tool) => !tool.name.startsWith("mcp__")),
		["read", "bash", "codemode"],
	);
	assert.deepEqual(compareTools(parent, reduced, "fork"), ["Unavailable tools: mcp__x__y"]);
	const permissive = toolInventory(all, ["read", "bash", "codemode", "plan_output"]);
	assert.match(
		compareTools(parent, permissive, "fork").join("\n"),
		/active here but not in the main agent: plan_output/,
	);
	const deactivated = toolInventory(all, ["read", "codemode"]);
	assert.match(compareTools(parent, deactivated, "fork").join("\n"), /active in the main agent but not here: bash/);
	assert.deepEqual(compareTools(parent, deactivated, "reopen"), [], "a reopened child keeps its own activation");
	assert.deepEqual(compareTools(parent, reduced, "reopen"), ["Unavailable tools: mcp__x__y"]);
});

test("model validation reports unavailable models, missing credentials and thinking drift", () => {
	const expected = { model: { provider: "anthropic", id: "opus" }, thinkingLevel: "high" };
	assert.deepEqual(compareModel(expected, { ...expected, hasAuth: true }), []);
	const issues = compareModel(expected, {
		model: { provider: "openai", id: "gpt" },
		thinkingLevel: "low",
		hasAuth: false,
	});
	assert.equal(issues.length, 3);
	assert.match(issues.join("\n"), /not available here/);
	assert.match(issues.join("\n"), /No saved credentials/);
});
