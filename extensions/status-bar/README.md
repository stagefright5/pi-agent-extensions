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
- Tested against pi 1.2.0 at tiny widths and 40/80/120/160 columns, including ANSI and wide Unicode text.

Cost follows pi's cumulative accounting across all session branches, not just current context. It is cached between session-entry changes rather than rescanning history on every frame.

Plan Mode uses the extension-status area to show its active state, plan title, iteration count, and work status.

## Scope and lifecycle

The extension runs only when `ctx.mode === "tui"`. It installs the custom footer when a session starts and restores pi's default footer when that session shuts down or extensions reload.

Because pi supports only one custom footer at a time, another footer extension loaded later can replace this one.

## Inside the Prompt Truly Mine composer

When [Prompt Truly Mine](../prompt-truly-mine/README.md) is loaded, its composer draws this status line inside its own footer bar and this footer returns no rows, saving a screen row. The line is lent through a global key (`Symbol.for("@stagefright5/pi-status-line/v1")`) rather than an import, so each package still works alone. Whenever the composer is not focused or cannot draw it (a picker, selector, or overlay is open, or the terminal is too small), this footer shows the line again in the same frame. The composer may pass a short centre segment (undo/redo hints or an overflow indicator); it is placed in the gap between the two groups only when it fits with room to spare.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-status-bar
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/status-bar` or expose it through the workspace's development symlink. Run `/reload` after source changes.
