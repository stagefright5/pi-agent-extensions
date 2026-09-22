# @stagefright5/pi-artifact-design

A pi skill for designing self-contained HTML artifacts. Its local Vite dev server
simulates runtime constraints so you can test them before publishing.

## Why

A published artifact is one self-contained HTML file. CSP blocks external stylesheets,
images and media. This skill lets you work in separate source files with HMR, then
bundles them into one validated file.

```
src/main.js + src/style.css + index.html
        ↓  dev    real HMR, theme/CSP/ground harness
        ↓  build  vite-plugin-singlefile inlines everything
dist/artifact.html   ← publish this
```

## Use

```bash
node scripts/scaffold.mjs ~/work/my-page --title "My Page"
cd ~/work/my-page && npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/artifact.html, validated
```

## What the dev harness gives you

|                        |                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme tri-state        | system / light / dark. `system` sets no attribute. Most viewers use this state, which a `[data-theme]`-only stylesheet renders incorrectly |
| Host-ground simulation | Paints the opposite theme's background behind the document to expose a transparent `body`                                                  |
| CSP headers            | The production allowlist, relaxed only for the HMR socket and unbundled modules                                                            |
| Capability stub        | Stubs every `window.artifactAgent` method and logs every call. `window.claude` is an alias                                                 |

The harness plugin uses `apply: "serve"`, so builds exclude it.

## What the validator rejects

The validator rejects off-allowlist external references, non-inlined relative assets,
custom properties defined only inside a theme block, and pages over 16MB. It warns
when a `body` background or `<title>` is missing. `build.mjs` exits non-zero on any error.

```bash
node scripts/validate.mjs some-artifact.html
```

## Contents

| Path                             |                                                                            |
| -------------------------------- | -------------------------------------------------------------------------- |
| `SKILL.md`                       | The skill itself                                                           |
| `references/FUNDAMENTALS.md`     | Design fundamentals, verbatim from Claude Code's bundled `artifact-design` |
| `references/DEV-SERVER.md`       | Dev server, harness and validator detail                                   |
| `references/GLOSSARY-SIDEBAR.md` | Pinned collapsible filterable glossary pattern                             |
| `scripts/`                       | scaffold, preview, build, validate                                         |
| `template/`                      | The scaffolded project                                                     |

## Attribution

`references/FUNDAMENTALS.md` is reproduced verbatim from the `artifact-design` skill
bundled with Claude Code 2.1.250. Anthropic owns that text. Everything else is original
to this package, including the Vite toolchain, harness, validator and glossary pattern.

The glossary pattern is proposed upstream as
[anthropics/claude-code#90263](https://github.com/anthropics/claude-code/issues/90263).

## Licence

Unlicense.
