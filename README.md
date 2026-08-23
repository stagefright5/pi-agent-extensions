# pi Agent Extensions

A Vite+ monorepo containing independently publishable packages for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), maintained on GitHub at [`stagefright5/pi-agent-extensions`](https://github.com/stagefright5/pi-agent-extensions). Vite+ provides the developer command surface and uses pnpm as the underlying workspace package manager.

The packages are maintained against pi **0.84.2** and use pi's TypeScript extension format without a build step.

> [!WARNING]
> Pi extensions execute with your user account's full system permissions. Review the source before installing or updating any extension or skill.

## Packages

| Workspace                                                                    | npm package                               | Purpose                                            | Primary interface                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| [Ask](./extensions/ask/README.md)                                            | `@stagefright5/pi-ask`                    | Apply an ask-before-deciding policy to one task    | `/ask <task>`                        |
| [Jenkins CLI Operations](./extensions/jenkins-cli-operations/README.md)      | `@stagefright5/pi-jenkins-cli-operations` | Guarded Jenkins workflows using the official CLI   | `/skill:jenkins-cli-operations`      |
| [Plan Mode](./extensions/plan-mode/README.md)                                | `@stagefright5/pi-plan-mode`              | Evidence-guided planning and interactive review    | `/plan`, `Alt+P`                     |
| [Global Prompt History Search](./extensions/prompt-history-search/README.md) | `@stagefright5/pi-prompt-history-search`  | Fuzzy reverse search across saved prompts          | `Alt+R`, `/prompt-history`           |
| [Prompt Truly Mine](./extensions/prompt-truly-mine/README.md)                | `@stagefright5/pi-prompt-truly-mine`      | Inline extension commands and skill/prompt context | inline `/`, `Ctrl+Z`, redo shortcuts |
| [Provider URL Logger](./extensions/provider-url-logger/README.md)            | `@stagefright5/pi-provider-url-logger`    | Log selected provider endpoints locally            | Automatic                            |
| [Compact Status Bar](./extensions/status-bar/README.md)                      | `@stagefright5/pi-status-bar`             | Compact cwd, Git, context, cost, and status footer | Automatic in TUI mode                |
| [Tool Output Browser](./extensions/tool-output-browser/README.md)            | `@stagefright5/pi-tool-output-browser`    | Inspect one complete stored tool result            | `/tool-output`                       |

Each workspace has its own `package.json`, version, Pi manifest, README, and npm release lifecycle. The repository root is private and is never published.

## Install standalone packages

After a package is published, install only the extension or skill you want:

```bash
pi install npm:@stagefright5/pi-ask
pi install npm:@stagefright5/pi-plan-mode
pi install npm:@stagefright5/pi-status-bar
pi install npm:@stagefright5/pi-jenkins-cli-operations
```

Use `pi config` to enable or disable resources from installed packages.

## Local development

Install the global `vp` command using the [Vite+ installation guide](https://viteplus.dev/guide), then install workspace dependencies:

```bash
vp install
```

The workspace pins Vite+ through its catalog and pnpm 11.22.0 through `packageManager`; Vite+ downloads and delegates to that pnpm version.

### Auto-discovery through a symlink

For development, point Pi's global extension directory at this repository's `extensions/` workspace directory:

```bash
ln -s ~/PersonalDev/pi-agent-extensions/extensions ~/.pi/agent/extensions
```

Pi auto-discovers each `extensions/*/index.ts`. The Jenkins wrapper exposes its colocated `SKILL.md` for source-tree development. Edit a source file and run `/reload` in Pi; no package build or reinstall is required.

### Temporary local loading

Load the complete collection from the private aggregate manifest while keeping other installed extensions enabled:

```bash
pi -e ~/PersonalDev/pi-agent-extensions
```

Load one package in isolation from the rest of this workspace:

```bash
pi -e ~/PersonalDev/pi-agent-extensions/extensions/plan-mode
```

If the same package is already loaded through the global symlink or npm, disable that copy with `pi config` before using `-e` to avoid duplicate handlers, commands, shortcuts, or UI components.

## Tests and package validation

Run every package's Node test script through the Vite+ task runner:

```bash
vp run test
```

Run one package's tests:

```bash
vp run @stagefright5/pi-prompt-truly-mine#test
vp run @stagefright5/pi-jenkins-cli-operations#test
```

Inspect the files that each workspace would publish:

```bash
vp run pack:check
```

Check, fix, lint, and format the workspace:

```bash
vp check
vp check --fix
vp lint
vp fmt
vp staged
```

The `staged` block in `vite.config.ts` runs safe Oxlint fixes before Oxfmt for staged JavaScript and TypeScript sources, and formats supported staged text assets. `.vite-hooks/pre-commit` invokes `vp staged`; use `vp hooks status` to inspect the clone-local dispatcher.

For an interactive Pi smoke test, start Pi normally through the development symlink, or pass the package path with `-e`. TUI-specific editors, overlays, footers, and shortcuts must be tested interactively.

## Versioning and publishing

The packages use independent Changesets releases:

```bash
vp run changeset
vp run version-packages
vp install
vp run test
vp run release
```

Commit the generated version and changelog changes before publishing. Every package includes the `pi-package` keyword for Pi package-gallery discovery.

## Local data and privacy

The collection operates locally or against services explicitly configured by the user, and some packages read or write user data:

- Jenkins CLI Operations connects to the configured Jenkins controller and stores non-secret connection metadata under the platform configuration directory. Credentials remain in the selected auth provider.
- Plan Mode stores plans and revision history under `~/.pi/plans/`; its optional summaries use the active model provider.
- Prompt History Search reads saved Pi sessions across projects into an in-memory index and local persisted index.
- Provider URL Logger appends endpoint metadata to `~/.pi/agent/provider-urls.log` without rotation.

No package intentionally uploads its own index or log. Normal agent requests and Plan Mode's generated change summaries still use the configured model provider.
