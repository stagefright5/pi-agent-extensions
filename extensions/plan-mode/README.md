# Plan Mode

Most of this extension was written with the pi agent CLI.

Plan Mode adds interactive planning to pi 0.84.2 and the 0.84.x API line. It supports review, approval, revision history, diffs, summaries, and Q&A.

[Back to the extension workspace](../../README.md)

Plan Mode guides the agent to inspect relevant evidence and resolve ambiguity that could affect the plan. The agent then writes a plan ready for implementation and waits for approval before implementing it.

## Start and reopen

- `/plan` toggles Plan Mode.
- `Alt+P` toggles Plan Mode.
- `pi --plan` starts a session with Plan Mode enabled.
- `/plan-review` reopens the latest presented plan while Plan Mode is active.
- `Ctrl+Alt+O` reopens the latest presented plan while Plan Mode is active.

Activating Plan Mode starts a fresh planning state in the current session. Deactivating it clears the active workflow but does not delete saved plan files.

## Workflow

1. Enable Plan Mode and describe the task.
2. The agent inspects relevant repository context or external documentation. It asks only questions whose answers could change the plan in a meaningful way.
3. The agent presents the complete plan through the `plan_output` tool.
4. Plan Mode saves `plan.md`, commits the iteration to a dedicated local Git repository, and opens an asynchronous TUI review overlay.
5. Approve the plan, request a revision, inspect its history, or close the overlay to continue discussing it.
6. Approval exits Plan Mode and queues a user message instructing the agent to execute the approved plan.
7. Revision feedback starts a discussion phase. The agent may answer normally, investigate, or ask clarifying questions. When the replacement plan is ready, the agent presents it in full by calling `plan_output` again.

Closing review with `Escape` displays a read-only copy of the plan in the main chat buffer. Use `/plan-review` or `Ctrl+Alt+O` to reopen the review overlay and its controls.

## Planning and approval boundary

While active, Plan Mode instructs the agent to:

- gather evidence that can affect correctness, scope, impact, assumptions, or validation in a meaningful way
- perform only read-only research and low-risk validation before approval
- identify intended outcomes, constraints, affected parts of the system, behavior to preserve, risks, and validation
- distinguish verified findings from assumptions and unresolved unknowns
- avoid implementation and destructive, irreversible, production, or external mutations before approval
- preserve the current active tool set instead of switching to a hard-coded read-only tool list

> [!IMPORTANT]
> Plan Mode relies primarily on system instructions to enforce the pre-approval boundary, not an operating-system sandbox or a hard block on mutating tools. Review tool calls as you normally would.

After presenting a plan, the agent answers ordinary questions in regular assistant text. A routing guard blocks accidental reuse of `plan_output` when the latest user message looks like clarification rather than an explicit revision request.

## Review shortcuts

Inside the plan review overlay:

- Press `a` to approve the plan.
- Press `r` to open an editor for revision feedback.
- Press `c` to copy the complete raw Markdown plan.
- Drag the mouse to select rendered plan text. Selection stays within the plan area and copies on release.
- Press `d` to show the diff from the previous iteration.
- Press `s` to generate a model summary of changes from the previous iteration.
- Press `S` to generate a model summary of all changes across iterations.
- Press `q` to show Q&A history.
- Use `Up` / `Down` / `j` / `k` to scroll.
- Use `Page Up` / `Page Down` to scroll by page.
- Use the mouse wheel to scroll.
- Press `Escape` to close review and continue the conversation.

Diff and summary actions become available after at least two iterations.

## Global shortcuts

Use these shortcuts while Plan Mode is active outside the review overlay:

- `Ctrl+Alt+D` shows the latest plan diff.
- `Ctrl+Alt+S` summarizes the latest changes.
- `Ctrl+Alt+A` summarizes all changes.
- `Ctrl+Alt+Q` shows Q&A history.
- `Ctrl+Alt+O` reopens the latest plan review.

## Persistence and files

Each plan is stored under:

```text
~/.pi/plans/<timestamp>_<title-slug>/plan.md
```

The containing directory is a dedicated Git repository. Plan Mode creates a seed commit, then commits each changed plan iteration so it can show revision diffs. It does not commit identical plan content again.

Plan Mode also saves the following state for each session branch through `pi.appendEntry()`:

- whether the mode is active
- plan directory and all iteration text
- current title
- Q&A messages
- whether a revision is pending

Plan Mode restores state from the active session branch on startup, reload, resume, fork, and tree navigation. When you navigate the session tree, it uses that branch's latest state.

Plan Mode excludes the display-only plan message created after closing review from model context to avoid duplicating stale plans.

## Model and data usage

- Planning uses the current agent model.
- Change summaries call the selected model directly and require an available API key. Plan Mode sends the relevant plan versions to that provider.
- Q&A history stores the text of user and assistant messages captured while Plan Mode is active in the pi session.
- Plans remain on local disk until you remove their directories.

## Requirements and limitations

- Interactive review, diffs, summaries, Q&A, clipboard copy, and revision editing require TUI mode.
- Git must be installed and available on `PATH` so Plan Mode can initialize and commit its local plan repositories.
- Summary generation requires a selected model and valid credentials.
- Clipboard copy depends on pi's clipboard support and the host environment.
- Plan Mode hides pi's normal working row while active and publishes progress through `ctx.ui.setStatus()`. The bundled Compact Status Bar displays that status.

## Files

- [`index.ts`](./index.ts) contains the extension entry point, planning prompt, tool and event registration, persistence, and TUI screens.
- [`utils.ts`](./utils.ts) generates plan-title slugs.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-plan-mode
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/plan-mode` or expose it through the workspace's development symlink. Run `/reload` after source changes.
