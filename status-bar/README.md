# Compact Status Bar

Replaces pi's multi-line built-in footer with a single global status line:

```text
cwd | context percentage/total window | cost | extension statuses
```

The status bar deliberately omits cumulative input/output/cache metrics and the model name. It keeps:

- the working directory and Git branch
- current context-window usage
- cumulative session cost
- active states published by extensions through `ctx.ui.setStatus()`

Context usage turns yellow above 70% and red above 90%. The complete line is truncated to the terminal width.

Plan Mode publishes its active state, current plan title, iteration count, and relevant shortcuts into the extension-status section.

## Installation

Place this directory at:

```text
~/.pi/agent/extensions/status-bar/
```

Pi auto-discovers `index.ts`. Run `/reload` or restart pi after changes.
