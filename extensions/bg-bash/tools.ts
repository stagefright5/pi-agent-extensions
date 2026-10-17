import { access } from "node:fs/promises";
import {
	createBashToolDefinition,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	getShellConfig,
	truncateTail,
	type AgentToolResult,
	type BashOperations,
	type BashToolDetails,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { formatDuration, readJobOutput, type ForegroundOutcome, type Job, type JobManager } from "./jobs.ts";

export const BACKGROUND_AFTER_SECONDS = 10;
const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
const STRUCTURED = { type: "json_schema", strict: "prefer" } as const;

export interface ShellSettings {
	shellPath?: string;
	commandPrefix?: string;
}

export interface ToolOptions {
	manager: JobManager;
	/** Current session id (names the log directory). */
	session(): string;
	/** Shell settings (`shellPath`, `shellCommandPrefix`) for the current session. */
	shell(): ShellSettings;
}

export type BackgroundBashDetails = BashToolDetails & {
	job?: { id: string; pid?: number; logPath?: string };
};

const bashSchema = Type.Object({
	command: Type.String({ description: "Shell command to execute" }),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Timeout in seconds (optional, no default timeout); also applies after the command moves to the background",
		}),
	),
});

const bashOutputSchema = Type.Object({
	output: Type.String({ description: "Combined stdout and stderr so far, possibly truncated" }),
	truncated: Type.Boolean(),
	full_output_path: Type.Optional(Type.String({ description: "Full output, when truncated" })),
	exit_code: Type.Optional(Type.Number({ description: "Absent while the command runs in the background" })),
	wall_time_seconds: Type.Number(),
	job_id: Type.Optional(Type.String({ description: "Background job id, when the command is still running" })),
	running: Type.Optional(Type.Boolean()),
	log_path: Type.Optional(Type.String({ description: "Complete output of the background job" })),
});

/** Normalize strict-mode nulls before the host validates the schema. */
function normalizeArguments<T>(args: unknown): T {
	if (!args || typeof args !== "object" || Array.isArray(args)) return args as T;
	return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null)) as T;
}

const idSchema = Type.String({ description: "Job id from the bash result, for example j3" });
const jobOutputParameters = Type.Object({
	id: idSchema,
	tail_lines: Type.Optional(Type.Integer({ description: "Number of last lines", minimum: 1, default: 200 })),
	offset: Type.Optional(
		Type.Integer({ description: "First line to read (1-indexed) instead of the tail", minimum: 1 }),
	),
	limit: Type.Optional(
		Type.Integer({
			description: "Lines (or matches) to read with offset or grep",
			minimum: 1,
			default: 200,
		}),
	),
	grep: Type.Optional(Type.String({ description: "Only lines matching this regular expression" })),
});

function validateSeconds(name: string, value: number | undefined, allowZero: boolean): void {
	if (value === undefined) return;
	if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
		throw new Error(`Invalid ${name}: must be a finite number of seconds`);
	}
	if (value > MAX_TIMEOUT_SECONDS) throw new Error(`Invalid ${name}: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
}

function backgroundNote(job: Job): string {
	return (
		`[Still running in background as job ${job.id} (pid ${job.pid ?? "?"}) after ${BACKGROUND_AFTER_SECONDS}s. Log: ${job.logPath}. ` +
		"Check it with job_output or job_status and stop it with job_kill; a bg-job message arrives when it exits.]"
	);
}

export function createBashTool(options: ToolOptions) {
	const { manager } = options;
	// Only for its renderers, description, and prompt text; each call builds its own executor.
	const base = createBashToolDefinition(process.cwd());
	return defineTool<typeof bashSchema, BackgroundBashDetails | undefined>({
		...base,
		description:
			`${base.description} Commands still running after ${BACKGROUND_AFTER_SECONDS} seconds move to the background ` +
			"and return a job id instead of their final output. This threshold is fixed and cannot be overridden by tool arguments.",
		promptGuidelines: [
			...(base.promptGuidelines ?? []),
			`bash commands still running after ${BACKGROUND_AFTER_SECONDS} seconds always continue as background jobs: the result says "Still running in background as job jN", and a bg-job message reports the exit later. This threshold is fixed; there is no wait argument. Do not poll in a loop; continue with other work or end your turn.`,
			"Use job_output, job_status, and job_kill to inspect or stop background jobs. The optional timeout limits total runtime; it does not extend the foreground period.",
		],
		parameters: bashSchema,
		prepareArguments: (args) => {
			const normalized = normalizeArguments<Static<typeof bashSchema> & { wait?: unknown }>(args);
			// Discard stale calls' former override, including calls from cached schemas.
			if (normalized && typeof normalized === "object") delete normalized.wait;
			return normalized;
		},
		outputSchema: bashOutputSchema,
		constrainedSampling: STRUCTURED,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const command = params.command;
			const timeout = params.timeout;
			validateSeconds("timeout", timeout, false);
			const settings = options.shell();
			let job: Job | undefined;
			let outcome: ForegroundOutcome | undefined;
			const operations: BashOperations = {
				exec: async (resolved, cwd, { onData, signal: abort, env }) => {
					try {
						await access(cwd);
					} catch {
						throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
					}
					const started = manager.start({
						command: resolved,
						cwd,
						env,
						timeout,
						shell: getShellConfig(settings.shellPath),
					});
					job = started;
					// The built-in accumulator throttles transcript updates; forward chunks as they come.
					const detach = started.attach(onData);
					try {
						outcome = await started.waitForeground(BACKGROUND_AFTER_SECONDS * 1000, abort);
					} finally {
						detach();
					}
					if (outcome === "abort") {
						started.kill("agent");
						manager.discard(started);
						throw new Error("aborted");
					}
					if (outcome === "exit") {
						manager.discard(started);
						// Pi\'s BashOperations adapter requires this sentinel to preserve captured output
						// (including truncation/file notices) before adding its friendly timeout message.
						if (started.state === "timed-out") throw new Error(`timeout:${timeout}`);
						return { exitCode: started.exitCode };
					}
					manager.background(started, options.session());
					return { exitCode: 0 };
				},
			};
			const builtin = createBashToolDefinition(ctx.cwd, { operations, commandPrefix: settings.commandPrefix });
			const result = (await builtin.execute(
				toolCallId,
				{ command, timeout },
				signal,
				onUpdate,
				ctx,
			)) as AgentToolResult<BackgroundBashDetails | undefined>;
			if (outcome !== "background" || !job) return result;

			const text = result.content.find((block) => block.type === "text")?.text ?? "";
			const prior = text === "(no output)" ? "" : text;
			const note = backgroundNote(job);
			const { exit_code: _exitCode, ...structured } = (result.structuredContent ?? {}) as Record<string, unknown>;
			return {
				content: [{ type: "text", text: prior ? `${prior}\n\n${note}` : note }],
				details: { ...result.details, job: { id: job.id, pid: job.pid, logPath: job.logPath } },
				structuredContent: { ...structured, job_id: job.id, running: true, log_path: job.logPath ?? "" },
			};
		},
	});
}

const jobInfoSchema = Type.Object({
	id: Type.String(),
	state: Type.String({ description: "running, exited, killed, or timed-out" }),
	command: Type.String(),
	cwd: Type.String(),
	pid: Type.Optional(Type.Number()),
	exit_code: Type.Optional(Type.Number()),
	elapsed_seconds: Type.Number(),
	log_path: Type.Optional(Type.String()),
	unread: Type.Boolean(),
});
type JobInfo = Static<typeof jobInfoSchema>;

function jobInfo(job: Job): JobInfo {
	return {
		id: job.id,
		state: job.state,
		command: job.command,
		cwd: job.cwd,
		...(job.pid !== undefined ? { pid: job.pid } : {}),
		...(job.state !== "running" && job.exitCode !== null ? { exit_code: job.exitCode } : {}),
		elapsed_seconds: Math.round(job.elapsedMs() / 100) / 10,
		...(job.logPath ? { log_path: job.logPath } : {}),
		unread: job.unread,
	};
}

export function jobLine(job: Job): string {
	const state =
		job.state === "running"
			? "running"
			: job.state === "exited"
				? `exited ${job.exitCode}`
				: job.state === "timed-out"
					? "timed out"
					: "killed";
	return `${job.id} ${state} · ${formatDuration(job.elapsedMs())} · pid ${job.pid ?? "?"} · ${job.command.replace(/\s+/gu, " ").trim()}`;
}

function reply(text: string, structured: object, isError = false): AgentToolResult<undefined> {
	return {
		content: [{ type: "text", text }],
		details: undefined,
		structuredContent: structured as AgentToolResult<undefined>["structuredContent"],
		...(isError ? { isError: true } : {}),
	};
}

function unknownJob(manager: JobManager, id: string): string {
	const known = manager.list().map((job) => job.id);
	return `No background job "${id}".${known.length ? ` Known jobs: ${known.join(", ")}.` : " There are no background jobs."}`;
}

const listSchema = Type.Object({ jobs: Type.Array(jobInfoSchema), error: Type.Optional(Type.String()) });

export function createJobTools(options: ToolOptions) {
	const { manager } = options;

	const jobStatus = defineTool({
		name: "job_status",
		label: "job status",
		description:
			"Show the state, exit code, runtime, pid, and log path of a background job started by bash, or of all jobs when no id is given.",
		promptSnippet: "Check background bash jobs (state, exit code, runtime)",
		parameters: Type.Object({ id: Type.Optional(idSchema) }),
		prepareArguments: (args) => normalizeArguments<{ id?: string }>(args),
		outputSchema: listSchema,
		constrainedSampling: STRUCTURED,
		annotations: { readOnlyHint: true },
		executionMode: "parallel",
		async execute(_toolCallId, params) {
			const id = params.id;
			const jobs = id === undefined ? manager.list() : [manager.get(id)].filter((job) => job !== undefined);
			if (id !== undefined && jobs.length === 0) {
				const error = unknownJob(manager, id);
				return reply(error, { jobs: [], error }, true);
			}
			for (const job of jobs) job.markRead(true);
			return reply(jobs.length ? jobs.map(jobLine).join("\n") : "No background jobs.", {
				jobs: jobs.map(jobInfo),
			});
		},
	});

	const jobList = defineTool({
		name: "job_list",
		// Retain the alias for explicit opt-in and old sessions, without another default declaration.
		defaultActive: false,
		label: "job list",
		description: "List background jobs started by bash, newest first.",
		promptSnippet: "List background bash jobs",
		parameters: Type.Object({}),
		outputSchema: listSchema,
		constrainedSampling: STRUCTURED,
		annotations: { readOnlyHint: true },
		executionMode: "parallel",
		async execute() {
			const jobs = manager.list();
			return reply(jobs.length ? jobs.map(jobLine).join("\n") : "No background jobs.", {
				jobs: jobs.map(jobInfo),
			});
		},
	});

	const jobOutput = defineTool({
		name: "job_output",
		label: "job output",
		description: `Read the output of a background job: its last lines (default 200), a line range from \`offset\`, or lines matching \`grep\` (a case-insensitive regular expression). Output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
		promptSnippet: "Read a background bash job's output (tail, line range, or grep)",
		parameters: jobOutputParameters,
		prepareArguments: (args) => normalizeArguments<Static<typeof jobOutputParameters>>(args),
		outputSchema: Type.Object({
			id: Type.String(),
			state: Type.Optional(Type.String()),
			exit_code: Type.Optional(Type.Number()),
			output: Type.String(),
			truncated: Type.Boolean(),
			note: Type.Optional(Type.String()),
			log_path: Type.Optional(Type.String()),
			error: Type.Optional(Type.String()),
		}),
		constrainedSampling: STRUCTURED,
		annotations: { readOnlyHint: true },
		executionMode: "parallel",
		async execute(_toolCallId, params) {
			const { id } = params;
			const { tail_lines, offset, limit, grep } = params;
			const job = manager.get(id);
			if (!job) {
				const error = unknownJob(manager, id);
				return reply(error, { id, output: "", truncated: false, error }, true);
			}
			const read = await readJobOutput(job, { tailLines: tail_lines, offset, limit, grep });
			const truncation = truncateTail(read.text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
			job.markRead(true);
			const header =
				jobLine(job) + (read.note ? ` · ${read.note}` : "") + (truncation.truncated ? " · truncated" : "");
			return reply(`${header}\n\n${truncation.content || "(no output)"}`, {
				id: job.id,
				state: job.state,
				...(job.state !== "running" && job.exitCode !== null ? { exit_code: job.exitCode } : {}),
				output: truncation.content,
				truncated: truncation.truncated,
				...(read.note ? { note: read.note } : {}),
				...(job.logPath ? { log_path: job.logPath } : {}),
			});
		},
	});

	const jobKill = defineTool({
		name: "job_kill",
		label: "job kill",
		description: "Stop a background job (SIGTERM to its process group, SIGKILL after 3 seconds).",
		promptSnippet: "Stop a background bash job",
		parameters: Type.Object({ id: idSchema }),
		outputSchema: Type.Object({
			id: Type.String(),
			killed: Type.Boolean(),
			state: Type.Optional(Type.String()),
			error: Type.Optional(Type.String()),
		}),
		constrainedSampling: STRUCTURED,
		annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
		executionMode: "sequential",
		async execute(_toolCallId, { id }) {
			const job = manager.get(id);
			if (!job) {
				const error = unknownJob(manager, id);
				return reply(error, { id, killed: false, error }, true);
			}
			const killed = job.kill("agent");
			if (killed) await Promise.race([job.exited(), new Promise((resolve) => setTimeout(resolve, 3500).unref())]);
			const text = killed ? `Stopped ${jobLine(job)}` : `${jobLine(job)} (already finished)`;
			return reply(text, { id: job.id, killed, state: job.state });
		},
	});

	return [jobStatus, jobList, jobOutput, jobKill];
}
