# pi Extensions

This repository is a small workspace for custom [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extensions.

Each extension lives in its own directory and should document its behavior locally.

## Structure

```text
.
├── README.md
└── plan-mode/
    ├── README.md
    ├── index.ts
    └── utils.ts
```

## Available extensions

- [`plan-mode/`](./plan-mode/README.md) — interactive planning mode for pi with clarifying questions, plan review, approval, diffs, summaries, and Q&A history.

## Installing an extension

pi auto-discovers extensions from these locations:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`
- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

So each directory in this repo is intended to be loadable as a pi extension.

After adding or updating an extension, restart pi or run `/reload`.

## Notes

- Root-level docs stay generic.
- Extension-specific usage, shortcuts, and behavior live in that extension's own `README.md`.
