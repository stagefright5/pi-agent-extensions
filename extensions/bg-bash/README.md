# Background Bash

Most of this extension was written with the pi agent CLI.

Replaces pi's `bash` tool. Commands that finish within 10 seconds return normally. Longer commands continue in the background, and the tool returns a job id:

```text
$ npm run build
> app@1.0.0 build
> vite build

[Still running in background as job j3 (pid 48121) after 10s. Log: /tmp/pi-bg-bash-<uid>/<session>-<unique>/j3.log. Check it with job_output or job_status and stop it with job_kill; a bg-job message arrives when it exits.]
```

When the job exits, the agent receives its exit code and last 40 lines of output.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-bg-bash
```

<!-- package-tools:install:end -->

## The `bash` tool

The tool keeps pi's built-in behavior for anything that finishes in time: the same streaming transcript row, truncation, full-output temp file, `PI_*` session variables, `shellPath` and `shellCommandPrefix` settings, and codemode result (`exit_code`, `output`, …). Other extensions that restyle `bash` rows keep working.

The foreground period is always 10 seconds, including for builds, tests, servers, and watchers. There is no `wait` parameter to override it. Any stale call that still supplies `wait` has that field discarded; even direct execution ignores it.

`timeout` keeps its meaning and keeps applying after a command moves to the background. Pressing `Esc` while the tool waits stops the command, as before; once a command is in the background, `Esc` no longer affects it.

A backgrounded result has no `exit_code`; codemode scripts get `job_id`, `running: true`, and `log_path` instead.

## Job tools

| Tool         | Use                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------- |
| `job_status` | State, exit code, runtime, pid, and log path of one job, or of all jobs.                    |
| `job_output` | The last lines (default 200), a line range (`offset`, `limit`), or matching lines (`grep`). |
| `job_list`   | Opt-in legacy alias: all jobs, newest first.                                                |
| `job_kill`   | SIGTERM to the job's process group, SIGKILL after 3 seconds.                                |

Each declares an output schema and annotations (`job_kill` is destructive, idempotent, and closed-world; the others are read-only and run in parallel). `job_list` is registered inactive by default; use `job_status` without an id, or explicitly enable the alias. Strict-mode nulls are normalized in `prepareArguments` before validation.

Logs are created with mode `0600` in private `0700` directories, independent of umask. Unique per-manager directories avoid collisions across Pi instances. Reload preserves jobs and logs; orderly session termination kills running jobs, waits for log closure, and removes that manager's logs. This cleanup applies to quit, new, resume, and fork, not reload. It waits up to 3.5 seconds for processes and up to one additional second for log closure before filesystem cleanup. That bounded delay prevents old-session jobs from leaking into a replacement session. Forced process termination can leave private files behind. Shell settings come from the active runtime's merged `pi.getSettings()`.

## Finish messages

A background job that exits on its own sends a `bg-job` message with its exit code, runtime, log path, and last 40 lines. If the agent is idle the message starts a turn; if it is busy the message waits as a follow-up instead of interrupting. In the transcript the message is one line, `○ j3 exited with code 0 · 42s · npm test`, that expands to the output.

Notifications depend on how the job stopped:

| Stopped by                    | Message                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| The agent, with `job_kill`    | None: the tool result already says so.                                      |
| You, with `Ctrl+K` in `/jobs` | `Background job j2 was stopped by the user after 1m45s: …`, as a follow-up. |
| Its `timeout`                 | `… timed out after …`, like any other exit.                                 |

## Footer indicator

While jobs run or finished jobs are unread, the footer shows:

```text
~/dev/app · main  ⏎ send · ● 2 running · ○1 ○1          anthropic/opus · high · 12.3%/200k · $0.412
```

- `● 2 running` (accent): running background jobs.
- `○1` (green): finished successfully, not looked at yet.
- `○1` (red): failed or timed out, not looked at yet.

A finished job counts as read once the agent calls `job_status` or `job_output` on it, or you select it in the jobs manager or mark everything read there. The finish message alone does not mark it read.

The indicator is an ordinary extension status, so it appears in pi's default footer too. With [Compact Status Bar](../status-bar/README.md) (and inside the [Prompt Truly Mine](../prompt-truly-mine/README.md) composer footer) it is also clickable and reachable with `Alt+S`.

## Jobs manager

Open it with `/jobs`, `Alt+J`, a click on the footer indicator, or `Alt+S` then `Enter`. It opens as a [Pi Dialog](../../packages/pi-dialog/README.md) popup: the border shows the match count, or the open log's job, command, and state. The popup fits its jobs (with room for a preview) and is never taller than half the terminal.

| Key                 | Action                                                |
| ------------------- | ----------------------------------------------------- |
| typing              | Search ids, commands, and directories                 |
| `Up` / `Down`       | Select a job; the preview follows its live output     |
| `Shift+Up` / `Down` | Scroll the preview                                    |
| `Ctrl+F`, number    | Filter: running, finished, failed, unread             |
| `Tab`               | Mark jobs for the actions below                       |
| `Enter`             | Open the full log (`f` toggles follow, `Esc` returns) |
| `Ctrl+K`, `Ctrl+K`  | Stop the job                                          |
| `Ctrl+Y` / `Ctrl+P` | Copy the log / its path                               |
| `Ctrl+D`            | Remove finished jobs from the list                    |
| `Ctrl+R`            | Mark all read                                         |
| `Ctrl+S`            | Send the output tail to the agent and close           |

## Lifecycle

- Each job runs in its own process group with stdin closed, like the built-in tool.
- Quick commands never touch the disk beyond what pi's built-in tool already does. A job's log file is created only when it moves to the background, starting with the output it printed while the tool waited.
- `/reload` keeps jobs running; the reloaded extension picks them up (and reports any that finished meanwhile). The job manager and its jobs are switched over to the reloaded code, so changes take effect without restarting pi. Quitting, `/new`, `/resume`, and `/fork` stop every job.

## Performance

Background output never redraws the screen by itself: output events are coalesced to at most four per second, the footer reacts only to state changes and re-sends its status only when the text changes, and the jobs manager redraws for output only when that job is selected. Its 1-second tick runs only while it is open and a job is running. Previews decode at most 32 KB of the in-memory tail once per output version, and the full log view reads new bytes incrementally, keeps at most 20,000 lines, and draws only the visible rows (a 50 MB log renders frames in well under 2 ms).

## Compatibility

Developed against pi 1.3.0. The click and `Alt+S` navigation need Compact Status Bar from this workspace; everything else works with any footer.
