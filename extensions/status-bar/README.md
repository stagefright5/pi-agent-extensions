# Compact Status Bar

Most of this extension was written with the pi agent CLI.

Replaces pi's built-in multi-line footer with a single-line status bar in TUI mode.

[Back to the extension workspace](../../README.md)

## Display

```text
cwd · git-branch · extension statuses         provider/model · thinking · context/window · cost
```

The footer includes:

- the current working directory, shortened to `~` when it is inside the home directory
- the current Git branch, when available
- estimated context usage and total model context window
- cumulative session cost, including assistant messages, tool/nested-call usage, compaction, branch summaries, and standalone usage entries such as cache warming
- the active provider, model display name, and thinking level, such as `anthropic/Claude Sonnet 4.6 (high)`; non-reasoning models show `(off)`
- `⚡︎` immediately after the thinking/effort level when OpenAI Fast mode is active; omitted when off
- other active statuses published by extensions through `ctx.ui.setStatus()`

The footer omits cumulative input, output, and cache-token metrics. It sorts extension statuses by status ID and removes line breaks. At full width they sit alongside the directory/branch; model, thinking, context and cost form a right-aligned group. Colors are read from the current theme on every render.

With Fast mode on, the model group reads:

```text
openai/GPT-6 Astra · high · ⚡︎ · 71.5%/272k · $16.991
```

The `fast` status is consumed by this indicator rather than duplicated beside the directory. It remains attached to the effort level when the model label is shortened.

## Colors and width

- Normal context usage appears dimmed.
- Usage above 70% appears as a warning.
- Usage above 90% appears as an error.
- The footer uses subtle dot separators, accent-colored branch names, and quiet metadata.
- It shortens the directory first, then the provider label before sacrificing other fields.
- At narrow widths, context (including warning/error color) and extension statuses take priority over model, cost, and location. Overlong status text is ellipsized, never allowed to overflow the terminal.
- Tested against pi 1.3.0 at tiny widths and 40/80/120/160 columns, including ANSI and wide Unicode text.

Cost follows pi's cumulative accounting across all session branches, not just current context. It is cached between session-entry changes rather than rescanning history on every frame.

Plan Mode uses the extension-status area to show its active state, plan title, iteration count, and work status.

## Clickable statuses

An extension can make its status clickable by registering an action under the same id it passes to `ctx.ui.setStatus` (`registerStatusAction` in the shared `status-line.ts` contract). [Background Bash](../bg-bash/README.md) uses this for its jobs indicator.

- **Mouse** (fullscreen `tuiMode`): click the status. The footer hit-tests the columns recorded during the latest layout; nothing is re-laid out.
- **Keyboard:** `Alt+S` highlights the first clickable status and shows its action (`⏎ jobs`). `←`/`→` or `Tab`/`Shift+Tab` move between clickable statuses, `Enter` runs the action, `Esc` or `Alt+S` leaves. Any other key leaves and reaches pi unchanged. The key listener exists only while navigating.

The footer is drawn on every frame, so the line is laid out only when an input changes (width, segments, directory, branch, statuses, context, model, cost, theme, or focus) and reused otherwise.

## Scope and lifecycle

The extension runs only when `ctx.mode === "tui"`. It installs the custom footer when a session starts and restores pi's default footer when that session shuts down or extensions reload.

Because pi supports only one custom footer at a time, another footer extension loaded later can replace this one.

## Inside the Prompt Truly Mine composer

When [Prompt Truly Mine](../prompt-truly-mine/README.md) is loaded, its composer draws this status line inside its own footer bar and this footer returns no rows, saving a screen row. The line is lent through a global key (`Symbol.for("@stagefright5/pi-status-line/v1")`) rather than an import, so each package still works alone. Whenever the composer is not focused or cannot draw it (a picker, selector, or overlay is open, or the terminal is too small), this footer shows the line again in the same frame. The composer passes its own segments, most important first (its mode label, then undo/redo hints or an overflow indicator). They follow the directory and branch, before extension statuses. When space runs out the last segment goes first, before any field is shortened, and the first segment outlives the directory on narrow terminals.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-status-bar
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/status-bar` or expose it through the workspace's development symlink. Run `/reload` after source changes.
