# pi Extensions

This repository is a small workspace for custom [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extensions.

The maintained extensions here target the current pi 0.80.x extension APIs and are kept as lightweight auto-discovered TypeScript scripts. No local package/workspace setup is required.

Each extension lives in its own directory and documents its behavior locally.

## Structure

```text
.
├── README.md
├── plan-mode/
│   ├── README.md
│   ├── index.ts
│   └── utils.ts
├── prompt-history-search/
│   ├── README.md
│   └── index.ts
├── prompt-undo-redo/
│   ├── README.md
│   └── index.ts
└── status-bar/
    ├── README.md
    └── index.ts
```

## Available extensions

- [`plan-mode/`](./plan-mode/README.md) — interactive planning mode for pi with clarifying questions, plan review, approval, diffs, summaries, Q&A history, and branch-aware state restoration.
- [`prompt-history-search/`](./prompt-history-search/README.md) — global reverse search (`Alt+R`) over user prompts from all saved sessions and projects.
- [`prompt-undo-redo/`](./prompt-undo-redo/README.md) — prompt editor undo/redo shortcuts (`Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`) with cursor-restoring snapshots.
- [`status-bar/`](./status-bar/README.md) — compact one-line footer showing cwd, context usage, cost, and extension statuses.

`herdr-agent-state.ts` is intentionally not covered by this modernization pass.

## Installing an extension

pi auto-discovers extensions from these locations:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`
- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

So each directory in this repo is intended to be loadable as a pi extension.

After adding or updating an extension, restart pi or run `/reload`.

## Current API patterns used

These extensions use modern pi APIs such as:

- `ctx.ui.setEditorComponent()` / `ctx.ui.getEditorComponent()` for custom editor replacement and composition
- `CustomEditor` for app-level editor keybinding support
- `ctx.ui.custom(..., { overlay, overlayOptions })` for TUI overlays
- `before_agent_start` with `event.systemPromptOptions` for context-aware system prompt customization
- `pi.registerTool()` with prompt metadata and custom renderers
- `pi.appendEntry()` plus session reconstruction for persistence

## Notes

- Root-level docs stay generic.
- Extension-specific usage, shortcuts, and behavior live in each extension's own `README.md`.
