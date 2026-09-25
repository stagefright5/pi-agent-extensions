# pi agent extensions

Independently publishable packages for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent), maintained at [`stagefright5/pi-agent-extensions`](https://github.com/stagefright5/pi-agent-extensions). The workspace uses Vite+ for development commands and pnpm for package management.

The packages target pi 0.84.2 and use pi's TypeScript extension format without a compilation step. Local development loads source directly; packing and publishing generate distribution metadata and assets.

> [!WARNING]
> Pi extensions execute with your user account's full system permissions. Review the source before installing or updating any extension or skill.

## Packages

<!-- package-tools:catalogue:start -->

<!-- prettier-ignore -->
| Workspace                                                                    | npm package                               | Purpose                                                                                                     | Primary interface                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [Artifact Design](./extensions/artifact-design/README.md)                    | `@stagefright5/pi-artifact-design`        | Design self-contained HTML artifacts with a local Vite dev server, theme/CSP harness, and single-file build | `/skill:artifact-design`             |
| [Ask](./extensions/ask/README.md)                                            | `@stagefright5/pi-ask`                    | Ask before decisions by applying a one-turn interaction policy in pi                                        | `/ask <task>`                        |
| [Bang Don't Ghost](./extensions/bang-dont-ghost/README.md)                   | `@stagefright5/pi-bang-dont-ghost`        | Automatically continue pi after a user-entered single-bang shell command                                    | Automatic                            |
| [Jenkins CLI Operations](./extensions/jenkins-cli-operations/README.md)      | `@stagefright5/pi-jenkins-cli-operations` | Guarded Jenkins operations for pi using the official Jenkins CLI                                            | `/skill:jenkins-cli-operations`      |
| [OpenAI Fast](./extensions/openai-fast/README.md)                            | `@stagefright5/pi-openai-fast`            | Toggle OpenAI Fast mode (priority service tier) in pi                                                       | `/fast`, `pi --fast`                 |
| [Plan Mode](./extensions/plan-mode/README.md)                                | `@stagefright5/pi-plan-mode`              | Evidence-guided planning and interactive plan review for pi                                                 | `/plan`, `Alt+P`                     |
| [Global Prompt History Search](./extensions/prompt-history-search/README.md) | `@stagefright5/pi-prompt-history-search`  | Fuzzy reverse search across prompts in saved pi sessions                                                    | `Alt+R`, `/prompt-history`           |
| [Prompt Truly Mine](./extensions/prompt-truly-mine/README.md)                | `@stagefright5/pi-prompt-truly-mine`      | Inline extension commands and composable skill/prompt context with cursor-restoring undo and redo for pi    | inline `/`, `Ctrl+Z`, redo shortcuts |
| [Provider URL Logger](./extensions/provider-url-logger/README.md)            | `@stagefright5/pi-provider-url-logger`    | Log the provider, model, and base URL selected for pi provider requests                                     | Automatic                            |
| [Compact Status Bar](./extensions/status-bar/README.md)                      | `@stagefright5/pi-status-bar`             | A compact single-line status bar for pi                                                                     | Automatic in TUI mode                |
| [Tool Output Browser](./extensions/tool-output-browser/README.md)            | `@stagefright5/pi-tool-output-browser`    | Browse complete stored tool results without expanding every pi transcript row                               | `/tool-output`                       |

<!-- package-tools:catalogue:end -->

Each package has its own source `package.json`, version, Pi manifest, and README. Packages release independently to npm. The repository root is private and is never published.

## Install standalone packages

After a package is published, install only the extension or skill you want:

<!-- package-tools:install:start -->

```bash
pi install npm:@stagefright5/pi-artifact-design
pi install npm:@stagefright5/pi-ask
pi install npm:@stagefright5/pi-bang-dont-ghost
pi install npm:@stagefright5/pi-jenkins-cli-operations
pi install npm:@stagefright5/pi-openai-fast
pi install npm:@stagefright5/pi-plan-mode
pi install npm:@stagefright5/pi-prompt-history-search
pi install npm:@stagefright5/pi-prompt-truly-mine
pi install npm:@stagefright5/pi-provider-url-logger
pi install npm:@stagefright5/pi-status-bar
pi install npm:@stagefright5/pi-tool-output-browser
```

<!-- package-tools:install:end -->

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

Load all packages from the root manifest while keeping other installed extensions enabled:

```bash
pi -e ~/PersonalDev/pi-agent-extensions
```

Load one package in isolation from the rest of this workspace:

```bash
pi -e ~/PersonalDev/pi-agent-extensions/extensions/plan-mode
```

If the same package is already loaded through the global symlink or npm, disable that copy with `pi config` before using `-e` to avoid duplicate handlers, commands, shortcuts, or UI components.

## Tests and package validation

Check generated indexes, test the packaging tooling, and run every package's Node test script through the Vite+ task runner:

```bash
vp run test
```

Run one package's tests:

```bash
vp run @stagefright5/pi-prompt-truly-mine#test
vp run @stagefright5/pi-jenkins-cli-operations#test
```

Stage all packages and inspect the files that each workspace would publish (without uploading anything):

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

## Generated package files

`scripts/package-tools.mjs` maintains two kinds of generated output:

- **Tracked indexes:** this package table and installation list, the root Pi manifest, and marked installation sections in package READMEs. These stay tracked so a fresh checkout works without a build.
- **Ignored distribution directories:** `.tmp/publish/<package>/`, containing runtime source/resources, a copied root `LICENSE`, a complete npm manifest, and a README with generated installation instructions and repository URLs.

The packaging integration tests require `pnpm` and `tar` on `PATH`. They pack all packages in a temporary workspace and inspect the tarballs without contacting a registry.

```bash
vp run packages:sync   # Update tracked indexes after changing package metadata
vp run packages:check  # Fail on drift without changing files
vp run packages:stage  # Check indexes and regenerate all distribution directories
```

Source manifests retain names, versions, descriptions, module type, package-specific keywords, dependencies, local Pi resources, and development scripts. `packageTools.title` and `packageTools.interface` supply catalogue labels. License and repository defaults come from the root manifest; `pi-package` and extension/skill keywords are derived from each package's Pi resources. Publication access and the branch used in README repository links come from the Changesets configuration.

The shared publication policy includes root JavaScript/TypeScript source, `README.md`, `CHANGELOG.md` when present, and `SKILL.md` when present. Skill packages additionally include `references/`, `scripts/`, and `template/`. Tests, dependencies, build output, and hidden files (except template `.gitignore` files) are excluded. The Bang Don't Ghost patcher remains source-only. Package-local `packageTools.include` and `packageTools.exclude` arrays accept explicit package-relative file/directory paths for exceptions; exclusions still apply to includes. Symlinks and paths outside the package are rejected.

Each package's `publishConfig.directory` points to its generated directory. `linkDirectory: false` keeps workspace dependency links pointed at source. A `prepack` hook refreshes that package's output for direct pnpm packing/publishing; use the root release command for Changesets. Published manifests omit development scripts, development dependencies and generator metadata. Source dependency requirements and release versions remain explicit; unresolved local/catalog runtime dependency references fail staging rather than leaking into npm.

Do not edit `.tmp/publish/` by hand or publish a source directory with a tool that ignores `publishConfig.directory`. Run `packages:sync` after adding or renaming a package or changing catalogue metadata, then commit the generated index changes. Root staging and per-package packing check drift before proceeding. Changelogs, templates, skill wrappers and the lockfile remain tracked. Changes to shared publication defaults may require Changesets for all affected packages.

## Versioning and publishing

The packages use independent Changesets releases:

```bash
vp run changeset
vp run version-packages
vp install
vp run test
vp run pack:check
vp run release
```

Commit the generated version and changelog changes before publishing. The release command regenerates distribution directories before Changesets publishes them. Every published package includes the `pi-package` keyword for Pi package-gallery discovery. Packing and staging never publish or create release tags.

## Local data and privacy

The packages run locally or connect to services you configure. Some read or write user data:

- Bang Don't Ghost starts a normal model-provider request after each eligible single-`!` command; Pi already includes that command and its output in model context.
- Jenkins CLI Operations connects to the configured Jenkins controller and stores non-secret connection metadata under the platform configuration directory. Credentials remain in the selected auth provider.
- Plan Mode stores plans and revision history under `~/.pi/plans/`; its optional summaries use the active model provider.
- Prompt History Search reads saved Pi sessions across projects into an in-memory index and local persisted index.
- Provider URL Logger appends endpoint metadata to `~/.pi/agent/provider-urls.log` without rotation.

No package intentionally uploads its own index or log. Normal agent requests and Plan Mode's generated change summaries still use the configured model provider.
