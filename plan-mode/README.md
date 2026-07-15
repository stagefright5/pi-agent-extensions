# Plan Mode

Interactive, evidence-guided planning for pi 0.80.7 and the 0.80.x API line, with review, approval, revision history, diffs, summaries, and Q&A.

[Back to the extension collection](../README.md)

Plan Mode guides the agent to resolve material ambiguity, inspect relevant evidence, produce an execution-ready implementation plan, and wait for approval before implementation.

## Start and reopen

- `/plan` — toggle Plan Mode
- `Alt+P` — toggle Plan Mode
- `pi --plan` — start a session with Plan Mode enabled
- `/plan-review` — reopen the latest presented plan while Plan Mode is active
- `Ctrl+Alt+O` — reopen the latest presented plan while Plan Mode is active

Activating Plan Mode starts a fresh planning state in the current session. Deactivating it clears the active workflow but does not delete saved plan files.

## Workflow

1. Enable Plan Mode and describe the task.
2. The agent inspects relevant repository context or external documentation and asks only questions whose answers could materially change the plan.
3. The agent presents the complete plan through the `plan_output` tool.
4. Plan Mode saves `plan.md`, commits the iteration to a dedicated local Git repository, and opens an asynchronous TUI review overlay.
5. Approve the plan, request a revision, inspect its history, or close the overlay to continue discussing it.
6. Approval exits Plan Mode and queues a user message instructing the agent to execute the approved plan.
7. Revision feedback starts a discussion phase. The agent may answer normally, investigate, or ask clarifying questions; it presents the complete replacement only when ready by calling `plan_output` again.

Closing review with `Escape` renders a display-only copy of the plan in the main chat buffer. Use `/plan-review` or `Ctrl+Alt+O` to reopen the actionable review overlay.

## Planning and approval boundary

While active, Plan Mode instructs the agent to:

- gather evidence that can materially affect correctness, scope, impact, assumptions, or validation
- perform only read-only research and low-risk validation before approval
- identify intended outcomes, constraints, affected surfaces, preserved behavior, risks, and validation
- distinguish verified findings from assumptions and unresolved unknowns
- avoid implementation and destructive, irreversible, production, or external mutations before approval
- preserve the current active tool set instead of switching to a hard-coded read-only tool list

> [!IMPORTANT]
> The pre-approval boundary is enforced primarily through system instructions, not an operating-system sandbox or a hard block on mutating tools. Review tool calls as you normally would.

After a plan is presented, ordinary questions are answered in regular assistant text. A routing guard blocks accidental reuse of `plan_output` when the latest user message looks like clarification rather than an explicit revision request.

## Review shortcuts

Inside the plan review overlay:

- `a` — approve the plan
- `r` — open an editor for revision feedback
- `c` — copy the complete raw Markdown plan
- mouse drag — select rendered plan text; selection is clipped to the plan area and copied on release
- `d` — show the diff from the previous iteration
- `s` — generate a model summary of changes from the previous iteration
- `S` — generate a model summary of all changes across iterations
- `q` — show Q&A history
- `Up` / `Down` / `j` / `k` — scroll
- `Page Up` / `Page Down` — page scroll
- mouse wheel — scroll
- `Escape` — close review and continue the conversation

Diff and summary actions become available after at least two iterations.

## Global shortcuts

These shortcuts are useful while Plan Mode is active outside the review overlay:

- `Ctrl+Alt+D` — show the latest plan diff
- `Ctrl+Alt+S` — summarize the latest changes
- `Ctrl+Alt+A` — summarize all changes
- `Ctrl+Alt+Q` — show Q&A history
- `Ctrl+Alt+O` — reopen the latest plan review

## Persistence and files

Each plan is stored under:

```text
~/.pi/plans/<timestamp>_<title-slug>/plan.md
```

The containing directory is a dedicated Git repository. It has a seed commit followed by a commit for every changed plan iteration, enabling revision diffs. Identical plan content is not committed again.

Plan Mode also persists the following branch-local state through `pi.appendEntry()`:

- whether the mode is active
- plan directory and all iteration text
- current title
- Q&A messages
- whether a revision is pending

State is reconstructed from the active session branch on startup, reload, resume, fork, and tree navigation, so navigating the session tree follows that branch's latest Plan Mode state.

The display-only plan message created after closing review is filtered out of model context to avoid duplicating stale plans.

## Model and data usage

- Normal planning uses the current agent model as usual.
- Change summaries call the currently selected model directly and require an available API key. The relevant plan versions are sent to that provider.
- Q&A history stores textual user and assistant messages captured while Plan Mode is active in the pi session.
- Plans remain on local disk until you remove their directories.

## Requirements and limitations

- Interactive review, diffs, summaries, Q&A, clipboard copy, and revision editing require TUI mode.
- Git must be installed and available on `PATH` so Plan Mode can initialize and commit its local plan repositories.
- Summary generation requires a selected model and valid credentials.
- Clipboard copy depends on pi's clipboard support and the host environment.
- Plan Mode hides pi's normal working row while active and publishes progress through `ctx.ui.setStatus()`; the bundled Compact Status Bar displays that status.

## Files

- [`index.ts`](./index.ts) — extension entry point, planning prompt, tool and event registration, persistence, and TUI screens
- [`utils.ts`](./utils.ts) — plan-title slug generation

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/plan-mode/
```

Run `/reload` or restart pi after installation.
