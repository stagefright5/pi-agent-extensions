---
name: artifact-design
description: Design and locally preview self-contained HTML artifacts. Use when building a single-file HTML page, document, dashboard, or landing page that will be published as an artifact, and when you need a live dev server with hot reload, theme and CSP checking, before publishing.
compatibility: Requires Node.js 20+ and network access to install vite and vite-plugin-singlefile into the scaffolded project.
---

# Artifact design

Choose a palette, typography, and layout that suit the subject and the task. Give each
artifact its own visual identity rather than reusing a generic template.

All paths below are relative to the directory containing this `SKILL.md`. Resolve them
to absolute paths before invoking tools; never assume the current working directory is
the skill directory.

## Workflow

### 1. Read the request

Design documents as carefully as landing pages, but adapt the style to the request.
Most requests need clear typographic hierarchy, consistent spacing, and a coordinated
palette without a large hero section. A landing page, a game, or a tool for repeated
use may call for an editorial style.

Read [references/FUNDAMENTALS.md](references/FUNDAMENTALS.md) before writing any code.
It is the full design brief and it governs everything below.

### 2. Plan before building

Plan a small token system first:

- Choose 4–6 named hex values for colors.
- Choose typefaces for at least two roles, such as a distinctive display face used sparingly, a body face, or a utility face for captions or data.
- Describe the layout in one or two sentences.

You must check the domain language before scaffolding:

1. Count the distinct domain terms, acronyms, protocol concepts, and specialist
   configuration names that a new reader may not know.
2. Record one of these decisions in the design plan:
   - `Glossary: yes — approximately N terms`; read
     [references/GLOSSARY-SIDEBAR.md](references/GLOSSARY-SIDEBAR.md) before building.
   - `Glossary: no — approximately N terms`; state why a glossary is unnecessary.
3. At approximately 15 or more terms, the glossary pattern is required for every
   artifact, including interactive explainers, architecture maps, dashboards,
   onboarding pages, and UI/document hybrids.

Use the plan for every color and type decision as you build.

### 3. Scaffold

```bash
node scripts/scaffold.mjs <target-dir> --title "Page Name"
cd <target-dir> && npm install
```

The template implements the three-state theme pattern. Use it rather than writing the
token structure from scratch.

### 4. Develop with the live server

```bash
npm run dev
```

The server runs Vite with HMR. Its harness simulates the published runtime with a
three-state theme control, host-ground simulation, artifact CSP headers, and a
`window.artifactAgent` capability stub. See [references/DEV-SERVER.md](references/DEV-SERVER.md).

Test all three theme states before considering the page done. `system` sets no
attribute and is the state most viewers use.

### 5. Build and validate

```bash
npm run build     # or: node scripts/build.mjs <target-dir>
```

The build command inlines everything into `dist/artifact.html` via `vite-plugin-singlefile`
and runs the validator. It exits non-zero on an off-allowlist reference, a non-inlined
asset, a theme token defined only inside a theme block, or a page over 16MB.

Repeat the domain-language check on the finished copy. Implementation often adds
terminology. If the glossary threshold is now met, add a glossary and verify desktop
pinning, collapse behavior, search, filters, mobile stacking, accessibility, and all
three theme states before publishing.

Never publish a file that has not passed validation and these checks.

### 6. Publish

Point the Artifact tool at `dist/artifact.html`. Publish that built file, not the
source `index.html`.

## Non-negotiables

1. Build one self-contained file. CSP blocks external stylesheets, images and media
   with no visible error. Only scripts from cdnjs / jsdelivr `/npm/` /
   cdn.tailwindcss.com / code.jquery.com, stylesheets from fonts.googleapis.com, and
   fonts from fonts.gstatic.com may be external. Inline everything else.
2. Support all three theme states. Define the complete palette on bare `:root`;
   redefine only tokens under `@media (prefers-color-scheme: dark)` guarded as
   `:root:not([data-theme="light"])`; redefine again under `:root[data-theme="dark"]`.
   Never give a color its only definition inside a themed block.
3. Set an explicit `background` on `body` using a token. A transparent body shows the
   host's background, which may be the opposite theme.
4. Use real content, never lorem ipsum.
5. Name the page like a product. Use a short noun phrase specific to the subject.
   Do not append an explanation after a dash or colon or use a generic category label.

## Patterns

- [Glossary sidebar](references/GLOSSARY-SIDEBAR.md) provides a pinned, collapsible,
  filterable term list for any artifact with approximately 15 or more domain terms,
  including interactive explainers and UI/document hybrids. It includes a fixed-height
  scrolling layout with three required CSS rules.

## Scripts

| Script                                          | Purpose                                |
| ----------------------------------------------- | -------------------------------------- |
| `scripts/scaffold.mjs <dir> [--title T]`        | New artifact project from the template |
| `scripts/preview.mjs [dir] [--port N] [--open]` | Dev server with HMR + harness          |
| `scripts/build.mjs [dir]`                       | Single-file build, then validate       |
| `scripts/validate.mjs <file.html>`              | Validate any built artifact standalone |
