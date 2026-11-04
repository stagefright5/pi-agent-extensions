/**
 * Child Pi invocation and configuration inheritance.
 *
 * The parent's argv is never forwarded wholesale. Only resource-loading, tool-selection,
 * system-prompt and display options are reconstructed (relative paths made absolute); session
 * selection, prompts, `--print`/`--mode`, model flags (the child transcript records the model) and
 * secrets are dropped. Project trust is reproduced from the parent's effective decision.
 */
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { LaunchConfig, ToolInventory } from "./store.ts";

/** Flag a managed child uses to find its launch reservation. Unknown to Pi without this extension. */
export const LAUNCH_FLAG = "side-agent-launch";

type Spec = { names: string[]; value: false | "path" | "path-or-text" | "text"; repeat?: boolean };

const FORWARDED: Spec[] = [
	{ names: ["-e", "--extension"], value: "path", repeat: true },
	{ names: ["--skill"], value: "path", repeat: true },
	{ names: ["--prompt-template"], value: "path", repeat: true },
	{ names: ["--theme"], value: "path", repeat: true },
	{ names: ["--append-system-prompt"], value: "path-or-text", repeat: true },
	{ names: ["--system-prompt"], value: "path-or-text" },
	{ names: ["-t", "--tools"], value: "text" },
	{ names: ["-xt", "--exclude-tools"], value: "text" },
	{ names: ["--models"], value: "text" },
	{ names: ["--session-dir"], value: "path" },
	{ names: ["--tui-mode"], value: "text" },
	{ names: ["--use-theme"], value: "text" },
	{ names: ["-ne", "--no-extensions"], value: false },
	{ names: ["--no-mcp"], value: false },
	{ names: ["-ns", "--no-skills"], value: false },
	{ names: ["-np", "--no-prompt-templates"], value: false },
	{ names: ["--no-themes"], value: false },
	{ names: ["-nc", "--no-context-files"], value: false },
	{ names: ["-nbt", "--no-builtin-tools"], value: false },
	{ names: ["-nt", "--no-tools"], value: false },
	{ names: ["--offline"], value: false },
	{ names: ["--verbose"], value: false },
];

/** Options that take a value but are not forwarded; their value must not be mistaken for a flag. */
const DROPPED_WITH_VALUE = new Set([
	"--model",
	"--provider",
	"--thinking",
	"--session",
	"--session-id",
	"--fork",
	"-n",
	"--name",
	"--mode",
	"--export",
	"--list-models",
	`--${LAUNCH_FLAG}`,
]);

const BLOCKERS: Record<string, string> = {
	"--api-key":
		"The main agent was started with `--api-key`. That key is not saved, and side agents never receive secrets on their command line. Store the credential with /login or an environment variable.",
};

export type InheritedArgs = { args: string[]; blockers: string[]; dropped: string[] };

/** Rebuild the supported subset of `argv` (without the executable and script). */
export function inheritArgs(argv: readonly string[], cwd: string): InheritedArgs {
	const args: string[] = [];
	const blockers: string[] = [];
	const dropped: string[] = [];
	const absolute = (value: string) =>
		value.startsWith("builtin:") || isAbsolute(value) ? value : resolve(cwd, value);
	for (let index = 0; index < argv.length; index++) {
		const raw = argv[index];
		if (raw === "--") break;
		if (!raw.startsWith("-")) continue;
		const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
		const name = eq > 0 ? raw.slice(0, eq) : raw;
		const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
		if (BLOCKERS[name]) {
			blockers.push(BLOCKERS[name]);
			if (inline === undefined) index++;
			continue;
		}
		const spec = FORWARDED.find((candidate) => candidate.names.includes(name));
		if (!spec) {
			if (DROPPED_WITH_VALUE.has(name) && inline === undefined) index++;
			dropped.push(name);
			continue;
		}
		const canonical = spec.names.at(-1)!;
		if (spec.value === false) {
			if (!args.includes(canonical)) args.push(canonical);
			continue;
		}
		const value = inline ?? argv[++index];
		if (value === undefined) continue;
		let resolved = value;
		if (spec.value === "path") resolved = absolute(value);
		else if (spec.value === "path-or-text") {
			const candidate = absolute(value);
			if (existsSync(candidate)) resolved = candidate;
		}
		if (!spec.repeat) {
			const previous = args.indexOf(canonical);
			if (previous >= 0) args.splice(previous, 2);
		}
		args.push(canonical, resolved);
	}
	return { args, blockers, dropped };
}

/** Non-secret Pi process variables that change where configuration lives or how Pi behaves. */
const FORWARDED_ENV = [
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_PACKAGE_DIR",
	"PI_OFFLINE",
	"PI_SKIP_VERSION_CHECK",
	"PI_TELEMETRY",
	"PI_CACHE_RETENTION",
	"PI_CODEMODE_MAX_WORKERS",
	"PI_CLEAR_ON_SHRINK",
	"PI_HARDWARE_CURSOR",
	"PI_HYPERLINKS",
	"PI_IMAGE_PROTOCOL",
	"PI_TRUE_COLOR",
	"PI_TUI_ESC_TIMEOUT",
	"PI_CLIPBOARD_OSC52",
];

/** Parent-session identity that must never leak into the child, even via the login environment. */
const UNSET_ENV = ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"];

export function inheritEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const result: Record<string, string> = {};
	for (const name of FORWARDED_ENV) {
		const value = env[name];
		if (value !== undefined && value !== "") result[name] = value;
	}
	return result;
}

export function launchConfig(options: {
	argv: readonly string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	trusted: boolean;
}): { config: LaunchConfig; blockers: string[] } {
	const inherited = inheritArgs(options.argv, options.cwd);
	return {
		config: { args: inherited.args, env: inheritEnv(options.env), trusted: options.trusted },
		blockers: inherited.blockers,
	};
}

/** The running Pi installation: its runtime, runtime flags and entry script. */
export function currentPiCommand(proc: Pick<NodeJS.Process, "execPath" | "execArgv" | "argv"> = process): string[] {
	const script = proc.argv[1];
	if (!script || script.startsWith("/$bunfs") || !existsSync(script)) return [proc.execPath];
	const runtimeFlags = proc.execArgv.filter((flag) => !/^--(inspect|debug)/.test(flag));
	return [proc.execPath, ...runtimeFlags, script];
}

/**
 * Child argv for Rex. `env` provides a clean, explicit environment layer over Rex's login
 * environment: it unsets inherited parent-session identity and sets allowlisted Pi variables.
 */
export function childCommand(options: {
	pi: readonly string[];
	sessionFile: string;
	token: string;
	config: LaunchConfig;
	envBinary?: string;
}): string[] {
	const env = options.envBinary ?? "/usr/bin/env";
	const unset = UNSET_ENV.flatMap((name) => ["-u", name]);
	const assignments = Object.entries(options.config.env)
		.filter(([name]) => /^[A-Z_][A-Z0-9_]*$/.test(name))
		.map(([name, value]) => `${name}=${value}`);
	return [
		env,
		...unset,
		...assignments,
		...options.pi,
		"--session",
		options.sessionFile,
		...options.config.args,
		options.config.trusted ? "--approve" : "--no-approve",
		`--${LAUNCH_FLAG}`,
		options.token,
	];
}

// Capability validation -----------------------------------------------------------------------

export type ToolDescriptor = { name: string; exposure?: string };

/** Callable = declared, or reachable without declaration through codemode/tool search. */
export function toolInventory(all: readonly ToolDescriptor[], active: readonly string[]): ToolInventory {
	const configured = [...new Set(all.map((tool) => tool.name))].sort();
	const activeSet = [...new Set(active)].sort();
	const callable = new Set(activeSet);
	for (const tool of all) if (tool.exposure === "codemode" || tool.exposure === "deferred") callable.add(tool.name);
	return { active: activeSet, callable: [...callable].sort(), configured };
}

const minus = (left: readonly string[], right: readonly string[]) => {
	const set = new Set(right);
	return left.filter((name) => !set.has(name));
};

/**
 * Differences that make the child reduced or more permissive than its parent.
 * - fork: active and callable sets must match exactly, and every configured tool must exist.
 * - reopen: the child keeps its own activation state; only missing configured tools are reported.
 */
export function compareTools(expected: ToolInventory, actual: ToolInventory, mode: "fork" | "reopen"): string[] {
	const issues: string[] = [];
	const list = (names: string[]) => names.join(", ");
	const missing = minus(expected.configured, actual.configured);
	if (missing.length) issues.push(`Unavailable tools: ${list(missing)}`);
	if (mode === "fork") {
		const inactive = minus(minus(expected.active, actual.active), missing);
		if (inactive.length) issues.push(`Tools active in the main agent but not here: ${list(inactive)}`);
		const extra = minus(actual.active, expected.active);
		if (extra.length) issues.push(`Tools active here but not in the main agent: ${list(extra)}`);
		const extraCallable = minus(minus(actual.callable, expected.callable), extra);
		if (extraCallable.length) issues.push(`Additional tools callable here: ${list(extraCallable)}`);
		const lostCallable = minus(minus(minus(expected.callable, actual.callable), missing), inactive);
		if (lostCallable.length) issues.push(`Tools no longer callable here: ${list(lostCallable)}`);
	}
	return issues;
}

export function compareModel(
	expected: { model?: { provider: string; id: string }; thinkingLevel?: string },
	actual: { model?: { provider: string; id: string }; thinkingLevel?: string; hasAuth: boolean },
): string[] {
	const issues: string[] = [];
	if (expected.model) {
		const want = `${expected.model.provider}/${expected.model.id}`;
		const got = actual.model ? `${actual.model.provider}/${actual.model.id}` : "none";
		if (want !== got) issues.push(`Model ${want} is not available here (using ${got}).`);
	}
	if (actual.model && !actual.hasAuth)
		issues.push(
			`No saved credentials for ${actual.model.provider}. Credentials that existed only in the main agent's process are not inherited.`,
		);
	if (expected.thinkingLevel && actual.thinkingLevel && expected.thinkingLevel !== actual.thinkingLevel)
		issues.push(`Thinking level is ${actual.thinkingLevel}, expected ${expected.thinkingLevel}.`);
	return issues;
}
