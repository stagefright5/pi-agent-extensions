# pi Agent Extensions

A collection of custom extensions for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), maintained on GitHub at [`stagefright5/pi-agent-extensions`](https://github.com/stagefright5/pi-agent-extensions).

The extensions are maintained against pi **0.80.7** (the 0.80.x API line), use pi's auto-discovered TypeScript extension format, and do not require a local build or package installation. This repository is laid out for direct clone or copy installation; it is not currently published as a pi package for `pi install`.

> [!WARNING]
> pi extensions execute with your user account's full system permissions. Review the source before installing or updating any extension.

## Extensions

| Extension | Purpose | Primary interface |
| --- | --- | --- |
| [Plan Mode](./plan-mode/README.md) | Evidence-guided planning with interactive review, revisions, diffs, summaries, Q&A history, and branch-aware persistence | `/plan`, `Alt+P` |
| [Global Prompt History Search](./prompt-history-search/README.md) | Fuzzy reverse search across prompts in all saved pi sessions | `Alt+R`, `/prompt-history` |
| [Prompt Undo/Redo](./prompt-undo-redo/README.md) | Cursor-restoring undo and redo for the prompt editor | `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y` |
| [Compact Status Bar](./status-bar/README.md) | One-line footer with cwd, Git branch, context usage, cost, and extension statuses | Automatic in TUI mode |
| [Provider URL Logger](./log-provider-url.md) | Appends the selected provider, model, and base URL for provider requests to a local log | Automatic |

Most interactive features require pi's TUI mode. See each extension's documentation for requirements, stored data, and limitations.

## Install the complete collection

The simplest installation is to clone this repository directly into pi's global extension directory:

```bash
git clone https://github.com/stagefright5/pi-agent-extensions.git ~/.pi/agent/extensions
```

The destination must not already contain files. Back up or move an existing `~/.pi/agent/extensions` directory before cloning.

Restart pi after installation, or run `/reload` from an existing session.

### Update

```bash
git -C ~/.pi/agent/extensions pull --ff-only
```

Then run `/reload` or restart pi.

### Install only selected extensions

Clone the repository elsewhere, then copy the desired file or directory into an auto-discovered extension location:

```bash
git clone https://github.com/stagefright5/pi-agent-extensions.git ~/src/pi-agent-extensions
mkdir -p ~/.pi/agent/extensions

# Directory extension
cp -R ~/src/pi-agent-extensions/plan-mode ~/.pi/agent/extensions/

# Single-file extension
cp ~/src/pi-agent-extensions/log-provider-url.ts ~/.pi/agent/extensions/
```

For project-local installation, copy into `.pi/extensions/` instead. Project-local extensions are loaded only after the project is trusted.

## Auto-discovery layout

pi loads extension entry points from:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`
- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

This repository follows that layout directly:

```text
.
├── README.md
├── log-provider-url.md
├── log-provider-url.ts
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

## Local data and privacy

The collection operates locally, but some extensions read or write user data:

- Plan Mode stores plans and revision history under `~/.pi/plans/`; its optional summaries use the active model provider.
- Prompt History Search reads saved pi sessions across projects into an in-memory index.
- Provider URL Logger appends endpoint metadata to `~/.pi/agent/provider-urls.log` without rotation.

No extension in this repository intentionally uploads its own index or log. Normal agent requests and Plan Mode's generated change summaries still use the configured model provider.

## Development

No repository-local build step is required. Edit the TypeScript sources and run `/reload` to reload extensions, skills, prompts, themes, and context files.

The implementation uses current pi APIs including:

- lifecycle hooks such as `before_agent_start`, `before_provider_request`, and session events
- `ctx.ui.custom()` overlays, custom editors, and custom footers
- commands, flags, shortcuts, tools, custom renderers, and extension status entries
- `pi.appendEntry()` with active-branch reconstruction for persisted state

Extension-specific behavior, shortcuts, storage, and caveats are documented in the linked pages above.
