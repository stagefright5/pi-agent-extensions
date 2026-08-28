# @stagefright5/pi-artifact-design

A pi skill for designing self-contained HTML artifacts, with a local Vite dev server
that reproduces the parts of the published runtime you otherwise only discover after
shipping.

## Why

A published artifact is one self-contained HTML file — CSP blocks external stylesheets,
images and media. That is a bad format to author in. This skill lets you author split
source with real HMR, then bundles to a single validated file.

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

|                            |                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Theme tri-state**        | system / light / dark. `system` stamps no attribute — the state most viewers are in, and the one a `[data-theme]`-only stylesheet renders wrong |
| **Host-ground simulation** | Paints the opposite theme's ground behind the document, so a transparent `body` fails visibly                                                   |
| **CSP headers**            | The real allowlist, relaxed only for the HMR socket and unbundled modules                                                                       |
| **Capability stub**        | `window.artifactAgent` (with `window.claude` aliased), every method logged and stubbed                                                          |

The harness plugin is `apply: "serve"`, so none of it can reach a build.

## What the validator rejects

Off-allowlist external references, non-inlined relative assets, custom properties
defined only inside a theme block, and pages over 16MB. Warns on a missing `body`
background or `<title>`. `build.mjs` exits non-zero on any error.

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
bundled with Claude Code 2.1.250; Anthropic owns that text. Everything else — the Vite
toolchain, harness, validator and glossary pattern — is original to this package.

The glossary pattern is proposed upstream as
[anthropics/claude-code#90263](https://github.com/anthropics/claude-code/issues/90263).

## Licence

Unlicense.
