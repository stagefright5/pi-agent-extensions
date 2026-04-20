# Plan Mode

Interactive planning mode for pi.

Plan Mode switches the agent into a read-only workflow where it must ask clarifying questions, build a plan, and wait for approval before making file changes.

## What it does

When enabled, this extension:

- restricts tool access to read-only exploration plus a custom `plan_output` tool
- requires the agent to ask clarifying questions before presenting a plan
- blocks `edit` and `write` while planning
- restricts `bash` to safe read-only commands
- renders plans in an interactive review UI
- stores each plan iteration in a per-plan git repo
- shows diffs between revisions
- generates LLM summaries of changes between iterations or across all iterations
- keeps a Q&A history for plan discussions
- restores full tool access after plan approval

## Activation

You can enable Plan Mode in any of these ways:

- `/plan` — toggle plan mode
- `Alt+P` — toggle plan mode
- `pi --plan` — start a session with plan mode enabled

## Workflow

1. Enable Plan Mode.
2. Ask the agent for help on a task.
3. The agent explores the codebase in read-only mode and asks clarifying questions.
4. Once ready, it presents a structured plan through the `plan_output` tool.
5. Review the plan in the TUI.
6. Approve it or request revisions.
7. After approval, normal tool access is restored and the agent can execute the approved plan.

## Review UI shortcuts

Inside the plan review screen:

- `a` — approve plan
- `r` — request revisions
- `d` — show diff from previous iteration
- `s` — summarize changes from previous iteration
- `S` — summarize all changes across iterations
- `q` — show Q&A history
- `↑` / `↓` / `j` / `k` — scroll
- `PgUp` / `PgDn` — page scroll
- `Esc` — close review and continue the conversation

## Global shortcuts while plan mode is active

- `Alt+P` — toggle plan mode
- `Ctrl+Alt+D` — show plan diff
- `Ctrl+Alt+S` — show change summary
- `Ctrl+Alt+A` — show all-changes summary
- `Ctrl+Alt+Q` — show Q&A history

## Files

- [`index.ts`](./index.ts) — extension entry point, UI, tool registration, state management, and event hooks
- [`utils.ts`](./utils.ts) — safe-command detection and slug generation helpers

## Persistence

Plan iterations are saved in a dedicated git repo under:

```text
~/.pi/plans/
```

Each plan gets its own timestamped directory and stores the current plan as `plan.md`, with git commits for every revision.

## How it integrates with pi

Plan Mode uses pi extension APIs to:

- register the `plan_output` custom tool
- inject planning-specific system instructions
- limit active tools during planning
- intercept and block destructive tool calls
- store extension state in the session
- render custom TUI screens for review, diffs, summaries, and Q&A

## Installation

Place this directory where pi can auto-discover it, for example:

```text
~/.pi/agent/extensions/plan-mode/
```

pi will load `index.ts` automatically. After changes, run `/reload` or restart pi.
