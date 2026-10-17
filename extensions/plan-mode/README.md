# Plan Mode

Most of this extension was written with the pi agent CLI.

Plan Mode adds interactive planning using pi 1.3.0's public extension and TUI APIs. It supports review, approval, revision history, diffs, summaries, and Q&A.

[Back to the extension workspace](../../README.md)

The agent inspects relevant evidence, asks about unresolved choices, writes a plan, and waits for approval before implementing it.

## Start and reopen

- `/plan` toggles Plan Mode.
- `Alt+P` toggles Plan Mode.
- `pi --plan` starts a session with Plan Mode enabled.
- `/plan-review` reopens the latest saved plan.
- `Ctrl+Alt+O` reopens the latest saved plan.

Activating Plan Mode starts a fresh planning state in the current session. Deactivating it clears the active workflow but does not delete saved plan files.

## Workflow

1. Enable Plan Mode and describe the task.
2. The agent inspects relevant repository context or external documentation. It asks only questions whose answers could change the plan.
3. The agent presents the complete plan through the `plan_output` tool.
4. Plan Mode saves `plan.md` and commits the iteration to a dedicated local Git repository. The review overlay opens after the agent settles, never from inside tool execution.
5. Approve the plan, request a revision, inspect its history, or close the overlay to continue discussing it.
6. Approval exits Plan Mode and queues a user message instructing the agent to execute the approved plan.
7. Revision feedback starts a discussion phase. The agent may answer normally, investigate, or ask clarifying questions. When the replacement plan is ready, the agent presents it in full by calling `plan_output` again.

Closing review with `Escape` displays a read-only copy of the plan in the main chat buffer. Use `/plan-review` or `Ctrl+Alt+O` to reopen the review overlay and its controls.

## Planning and approval boundary

While active, Plan Mode instructs the agent to:

- gather evidence that can change correctness, scope, impact, assumptions, or validation
- perform only read-only research and low-risk validation before approval
- identify intended outcomes, constraints, affected parts of the system, behavior to preserve, risks, and validation
- distinguish verified findings from assumptions and unresolved unknowns
- avoid implementation and destructive, irreversible, production, or external mutations before approval
- preserve the current active tool set instead of switching to a hard-coded read-only tool list

> [!IMPORTANT]
> Plan Mode relies primarily on system instructions to enforce the pre-approval boundary, not an operating-system sandbox or a hard block on mutating tools. Review tool calls as you normally would.

After presenting a plan, the agent answers ordinary questions in regular assistant text. A routing guard blocks accidental reuse of `plan_output` when the latest user message looks like clarification rather than an explicit revision request.

## Review shortcuts

The review, diff, summary, and Q&A views use the same panel color as [Pi Picker](../../packages/pi-picker/README.md), darker than the composer:

- The header shows what you are viewing, the plan title, the iteration, and how far you have scrolled. The plan file path sits below it, then a thin rule.
- The document is inset from both edges. A thin bar in the right margin shows where you are in a long plan.
- Below another rule, the footer lists the actions. Approve is highlighted; copy and close sit on the right. On narrow screens the secondary actions are hidden from the legend but their keys still work.

While the agent writes a plan, its `plan_output` row shows line and character counts and the current section. The review opens when the plan is saved.

Inside the plan review overlay:

- Press `a` to approve the plan.
- Press `r` to open an editor for revision feedback.
- Press `c` to copy the complete raw Markdown plan.
- In fullscreen mode, drag to select rendered plan text. Selection stays within the plan area and copies on release.
- Press `d` to show the diff from the previous iteration.
- Press `s` to generate a model summary of changes from the previous iteration.
- Press `S` to generate a model summary of all changes across iterations.
- Press `q` to show Q&A history.
- Use `Up` / `Down` / `j` / `k` to scroll.
- Use `Page Up` / `Page Down` to scroll by page.
- In fullscreen mode, use the mouse wheel to scroll. Regular mode leaves mouse reporting to the terminal; all actions remain available by keyboard.
- Press `Escape` to close review and continue the conversation.

Diff and summary actions become available after at least two iterations. Review, diff, summary, and Q&A share one resizable, scrollable viewer. Selection and confirmation keys respect pi's keybindings. `Home`/`g` and `End`/`G` jump to the start and end. Tiny viewports use a compact layout rather than overflowing.

Cancelling a summary aborts its model request. Session shutdown, reload, tree navigation, and toggling the workflow cancel its interactions and pending saves. A review cannot approve an outdated iteration or a plan that is still being saved.

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
~/.pi/agent/plans/<timestamp>_<title-slug>_<unique-suffix>/plan.md
```

New plans use `getAgentDir()/plans`, respecting `PI_CODING_AGENT_DIR`. Resumed sessions keep their recorded plan directory, including older `~/.pi/plans` locations; existing files are not moved.

The containing directory is a dedicated Git repository. Plan Mode creates a seed commit, then commits changed plan content. Unique directories prevent same-second title collisions. Diffs compare the active branch's saved iteration text, including identical iterations, rather than assuming Git HEAD matches the active session branch.

`plan_output` is model-only and sequential, registered inactive, and enabled only in TUI plan mode. Mode changes preserve the other active tools. Calls outside plan mode are rejected. A session-local queue and the SDK file-mutation queue serialize saves. State advances only after storage succeeds; failed saves return tool errors. New-repository failures are cleaned up, and failed edits restore the previous file. Cancelled tool batches do not automatically open a review; `/plan-review` can reopen any successfully saved plan.

Plan Mode saves only small workflow flags and metadata through `pi.appendEntry()`: active/revision state, title, directory, and workflow reset boundaries. Each successful `plan_output` result stores that iteration in `details`; Q&A is reconstructed from user/assistant messages. Ordinary messages no longer append full plan/Q&A snapshots. Legacy snapshots remain readable.

Plan Mode restores state from the active session branch on startup, reload, resume, fork, and tree navigation. When you navigate the session tree, it uses that branch's latest state. Restoration itself is read-only: a legacy branch gets its small v2 replay boundary only when new messages or workflow changes occur, not merely when opened or navigated.

Closing review appends a display-only custom entry with an entry renderer, never a model message. Filters for legacy display/context messages remain for older sessions.

## Model and data usage

- Planning uses the current agent model.
- Change summaries use provider-neutral `streamSimple()` with the selected model and send the relevant versions to that provider. Usage is saved as `extension-model-usage` entries and included by Compact Status Bar. Pi 1.3.0 has no public API to append native usage from UI commands, so built-in `/session` totals exclude these entries.
- Reported usage is retained even when a summary is cancelled. During session teardown, requests are aborted and given up to one second to return usage before the old runtime is closed; late results never write into a replacement session. Providers that omit usage or ignore cancellation past that grace period can still cause under-reporting, so these totals are not a billing ledger.
- Q&A history stores the text of user and assistant messages captured while Plan Mode is active in the pi session.
- Plans remain on local disk until you remove their directories.

## Requirements and limitations

- Interactive review, diffs, summaries, Q&A, clipboard copy, and revision editing require TUI mode.
- Git must be installed and available on `PATH` so Plan Mode can initialize and commit its local plan repositories.
- Summary generation requires a selected model and valid credentials.
- Clipboard copy depends on pi's clipboard support and the host environment.
- Plan Mode hides pi's normal working row while active and publishes progress through `ctx.ui.setStatus()`. The bundled Compact Status Bar displays that status.

## Files

- [`index.ts`](./index.ts) owns tool/event registration, branch state, and workflow lifecycle.
- [`state.ts`](./state.ts) reconstructs branch state, including legacy snapshots.
- [`planning.ts`](./planning.ts) contains the planning prompt and routing helpers.
- [`plan-ui.ts`](./plan-ui.ts) provides Markdown, editor, and loader components, a ScrollView-based viewer, and mouse handling.
- [`plan-store.ts`](./plan-store.ts) serializes saves, commits plans, and generates diffs.
- [`utils.ts`](./utils.ts) generates plan-title slugs.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-plan-mode
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/plan-mode` or expose it through the workspace's development symlink. Run `/reload` after source changes.
