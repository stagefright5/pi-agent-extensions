# Compact Status Bar

Replaces pi's built-in multi-line footer with a compact, single-line status bar in TUI mode.

[Back to the extension collection](../README.md)

## Display

```text
cwd (git-branch) | context percentage/window | cost | extension statuses
```

The footer includes:

- the current working directory, shortened to `~` when it is inside the home directory
- the current Git branch, when available
- estimated context usage and total model context window
- cumulative assistant-message cost for the session
- active statuses published by extensions through `ctx.ui.setStatus()`

It deliberately omits the model name and cumulative input, output, and cache-token metrics. Extension statuses are sorted by status ID, sanitized to one line, and appended after the built-in fields.

## Colors and width

- normal context usage is dimmed
- usage above 70% is shown as a warning
- usage above 90% is shown as an error
- the complete footer is truncated with an ellipsis to fit the terminal width

Plan Mode uses the extension-status area to show its active state, plan title, iteration count, and relevant shortcuts.

## Scope and lifecycle

The extension runs only when `ctx.mode === "tui"`. It installs the custom footer when a session starts and restores pi's default footer when that session shuts down or extensions reload.

Because pi supports only one custom footer at a time, another footer extension loaded later can replace this one.

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/status-bar/
```

Run `/reload` or restart pi after installation.
