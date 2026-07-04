# Plan Mode

Interactive planning mode for pi.

Plan Mode switches the agent into a guided planning workflow where it must ask clarifying questions, build a plan, and wait for approval before executing the plan.

## What it does

When enabled, this extension:

- leaves the current active tool set unchanged while planning
- requires the agent to gather missing knowledge from both the user and the codebase before presenting a plan
- pushes the agent to perform impact analysis so the user can avoid blindspots, unexpected changes, and unknown behaviors
- uses the latest `before_agent_start.systemPromptOptions` context to tailor planning instructions to the active tools, loaded context files, and loaded skills
- hides pi's built-in working row while plan mode is active and shows planning progress in the plan-mode status/widget instead
- instructs the agent to wait for approval before executing changes
- renders plans in an overlay review UI without keeping the `plan_output` tool running while you review
- renders a highlighted plan box in the main chat buffer when the review overlay is closed without approval or revision
- keeps that chat-buffer plan copy display-only and filters it out of LLM context to avoid duplicating stale plans
- stores each plan iteration in a per-plan git repo
- shows diffs between revisions
- generates LLM summaries of changes between iterations or across all iterations
- keeps a Q&A history for plan discussions
- answers post-plan clarification questions normally instead of replacing the saved plan
- keeps a pending revision state so the agent can clarify/investigate during revisions but must submit the revised complete plan through `plan_output`
- guards `plan_output` after a plan is presented so it is only used for explicit revisions/replacements
- ignores modern `toolCall` plan submissions when building the Q&A history
- does not modify tool activation state when entering or leaving plan mode

## Activation

You can enable Plan Mode in any of these ways:

- `/plan` — toggle plan mode
- `Alt+P` — toggle plan mode
- `pi --plan` — start a session with plan mode enabled

## Workflow

1. Enable Plan Mode.
2. Ask the agent for help on a task.
3. The agent explores the codebase, asks clarifying questions, and prepares a plan.
4. Once ready, it presents a structured plan through the `plan_output` tool.
5. Review the plan in the TUI overlay.
6. Approve it, request revisions, or press `Esc` to close the overlay and continue chatting with the plan rendered in the main chat buffer.
7. During revision, the agent may inspect more context, use web search if available, and ask/answer clarification questions in normal chat; when ready it must present the revised complete plan with `plan_output` again.
8. After approval, plan mode exits and the agent can execute the approved plan.

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
- [`utils.ts`](./utils.ts) — slug generation helpers

## Persistence

Plan iterations are saved in a dedicated git repo under:

```text
~/.pi/plans/
```

Each plan gets its own timestamped directory and stores the current plan as `plan.md`, with git commits for every revision.

## How it integrates with pi

Plan Mode uses pi extension APIs to:

- register the `plan_output` custom tool
- inject plan-specific system instructions using the latest structured system prompt context from pi
- keep tool activation unchanged while planning
- store extension state in the session
- render custom TUI screens for review, diffs, summaries, and Q&A

## Installation

Place this directory where pi can auto-discover it, for example:

```text
~/.pi/agent/extensions/plan-mode/
```

pi will load `index.ts` automatically. After changes, run `/reload` or restart pi.
