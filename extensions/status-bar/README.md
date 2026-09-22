# Compact Status Bar

Most of this extension was written with the pi agent CLI.

Replaces pi's built-in multi-line footer with a single-line status bar in TUI mode.

[Back to the extension workspace](../../README.md)

## Display

```text
cwd (git-branch) | context percentage/window | cost | provider/model display name (thinking level) | extension statuses
```

The footer includes:

- the current working directory, shortened to `~` when it is inside the home directory
- the current Git branch, when available
- estimated context usage and total model context window
- cumulative assistant-message cost for the session
- the active provider, model display name, and thinking level, such as `anthropic/Claude Sonnet 4.6 (high)`; non-reasoning models show `(off)`
- active statuses published by extensions through `ctx.ui.setStatus()`

The footer omits cumulative input, output, and cache-token metrics. It sorts extension statuses by status ID, removes line breaks, and appends them after the built-in fields.

## Colors and width

- Normal context usage appears dimmed.
- Usage above 70% appears as a warning.
- Usage above 90% appears as an error.
- The footer truncates with an ellipsis to fit the terminal width.

Plan Mode uses the extension-status area to show its active state, plan title, iteration count, and relevant shortcuts.

## Scope and lifecycle

The extension runs only when `ctx.mode === "tui"`. It installs the custom footer when a session starts and restores pi's default footer when that session shuts down or extensions reload.

Because pi supports only one custom footer at a time, another footer extension loaded later can replace this one.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-status-bar
```

For source development, load this directory with `pi -e ./extensions/status-bar` or expose it through the workspace's development symlink. Run `/reload` after source changes.
