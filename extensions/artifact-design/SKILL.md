---
name: artifact-design
description: Design and locally preview self-contained HTML artifacts. Use when building a single-file HTML page, document, dashboard, or landing page that will be published as an artifact, and when you need a live dev server with hot reload, theme and CSP checking, before publishing.
compatibility: Requires Node.js 20+ and network access to install vite and vite-plugin-singlefile into the scaffolded project.
---

# Artifact design

Approach this as the design lead at a small studio known for versatility, giving every
client a visual identity pitched at the treatment the task actually calls for. Make
deliberate choices about palette, typography, and layout specific to this subject, and
avoid templated designs.

All paths below are relative to the directory containing this `SKILL.md`. Resolve them
to absolute paths before invoking tools; never assume the current working directory is
the skill directory.

## Workflow

### 1. Read the request

Calibrate treatment, not whether to design. A doc deserves the same craft as a landing
page — what changes is the treatment that craft is delivered in. Most requests want a
_polished but utilitarian_ result: real typographic hierarchy, considered spacing, a
proper palette, no gigantic hero. Some — a landing page, a game, a tool they will keep
— want an editorial treatment.

Read [references/FUNDAMENTALS.md](references/FUNDAMENTALS.md) before writing any code.
It is the full design brief and it governs everything below.

### 2. Plan before building

Sketch a compact token system first:

- **Color** — 4–6 named hex values
- **Type** — typefaces for 2+ roles: a characterful display face used with restraint, a body face, a utility face for captions or data
- **Layout** — the concept in one or two sentences

Run a **mandatory domain-language preflight** before scaffolding:

1. Count the distinct domain terms, acronyms, protocol concepts, and specialist
   configuration names that a new reader may not know.
2. Record one of these decisions in the design plan:
   - `Glossary: yes — approximately N terms`; read
     [references/GLOSSARY-SIDEBAR.md](references/GLOSSARY-SIDEBAR.md) before building.
   - `Glossary: no — approximately N terms`; state why a glossary is unnecessary.
3. At approximately 15 or more terms, the glossary pattern is required. This applies to
   every artifact — including interactive explainers, architecture maps, dashboards,
   onboarding pages, and UI/document hybrids — not only prose documents.

Then build, deriving every color and type decision from that plan.

### 3. Scaffold

```bash
node scripts/scaffold.mjs <target-dir> --title "Page Name"
cd <target-dir> && npm install
```

The template already implements the three-state theme pattern correctly. Start from it
rather than hand-rolling the token structure.

### 4. Develop with the live server

```bash
npm run dev
```

Vite with HMR, plus a harness that reproduces what only bites after publish: a theme
tri-state control, host-ground simulation, artifact CSP headers, and a
`window.artifactAgent` capability stub. See [references/DEV-SERVER.md](references/DEV-SERVER.md).

**Cycle all three theme states before considering the page done.** `system` stamps no
attribute and is the state most viewers are in.

### 5. Build and validate

```bash
npm run build     # or: node scripts/build.mjs <target-dir>
```

Inlines everything into `dist/artifact.html` via `vite-plugin-singlefile` and runs the
validator. It exits non-zero on an off-allowlist reference, a non-inlined asset, a
theme token defined only inside a theme block, or a page over 16MB.

Repeat the domain-language preflight against the finished copy because terminology
usually grows during implementation. If the glossary threshold is now met, add it and
verify desktop pinning, collapse behavior, search, filters, mobile stacking,
accessibility, and all three theme states before publishing.

Never publish a file that has not passed this.

### 6. Publish

Point the Artifact tool at `dist/artifact.html`. Publish that built file, not the
source `index.html`.

## Non-negotiables

1. **One self-contained file.** External stylesheets, images and media are blocked by
   CSP with no visible error. Only scripts from cdnjs / jsdelivr `/npm/` /
   cdn.tailwindcss.com / code.jquery.com, stylesheets from fonts.googleapis.com, and
   fonts from fonts.gstatic.com may be external. Everything else inlines.
2. **Three theme states, not two.** Define the complete palette on bare `:root`;
   redefine _only tokens_ under `@media (prefers-color-scheme: dark)` guarded as
   `:root:not([data-theme="light"])`; redefine again under `:root[data-theme="dark"]`.
   Never give a color its only definition inside a themed block.
3. **Explicit `background` on `body`,** from a token. A transparent body borrows the
   host's ground and inverts in one theme.
4. **Real content, never lorem.**
5. **Name the page like a product.** A short noun phrase specific to the subject — no
   appended explainer after a dash or colon, no generic category label.

## Patterns

- [Glossary sidebar](references/GLOSSARY-SIDEBAR.md) — pinned, collapsible, filterable
  term list for any artifact carrying ~15+ domain terms, including interactive
  explainers and UI/document hybrids. Includes the fixed-height scroll shell, which has
  three non-obvious CSS requirements.

## Scripts

| Script                                          | Purpose                                |
| ----------------------------------------------- | -------------------------------------- |
| `scripts/scaffold.mjs <dir> [--title T]`        | New artifact project from the template |
| `scripts/preview.mjs [dir] [--port N] [--open]` | Dev server with HMR + harness          |
| `scripts/build.mjs [dir]`                       | Single-file build, then validate       |
| `scripts/validate.mjs <file.html>`              | Validate any built artifact standalone |
