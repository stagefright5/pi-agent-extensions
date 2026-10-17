# Design fundamentals

> Adapted from the `artifact-design` skill bundled with Claude Code 2.1.250.
> Anthropic owns the source text. This version edits its wording for clarity.
> To compare with upstream, extract the blob at `---\nname: artifact-design` from the Claude Code binary.

Choose colors, typography, and layout for the subject and the task. Do not reuse a generic design unchanged.

## Read the request first

Plans, memos, and demos need typographic hierarchy, consistent spacing, and a coordinated palette. They rarely need a large hero section or elaborate decoration. Landing pages, games, and tools for repeated use may need a more distinctive visual identity.

Author HTML. Publish Markdown only when a loaded skill explicitly requires it. Markdown publishing retains the filename as the title and does not support most of the design guidance below. Do not choose it merely to save time.

Apply the fundamentals to every artifact. Use the editorial process at the end only when the request calls for it. When unsure, prioritize readable layout over decoration.

## Fundamentals for every artifact

### Follow the existing design system

Check `CLAUDE.md`, token and theme files, and existing component styles. Apply them before making new choices. Follow the user's instructions first, the project's design system second, and this guidance for remaining decisions.

### Identify the subject and audience

State the page's subject, intended readers, and purpose. Use relevant terminology and imagery to guide the design. Build with real content, never lorem ipsum.

### Pair typefaces

Choose complementary display and body faces. Google Fonts is the only external font host the Artifact CSP permits. Link it directly:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap" />
```

Inline fonts from other sources as `@font-face` data URIs or they will fall back silently. Always declare a fallback stack.

Keep running text near 65 characters wide. Use a consistent type scale, `text-wrap: balance` on headings, readable body line-height, and slight letter-spacing on uppercase labels.

### Load libraries only when needed

If the page needs React, a charting library, or a syntax highlighter, load a pinned UMD build from cdnjs before the inline script that uses its global. Inline the library's stylesheet. Do not paste its source or write a substitute. The Artifact tool's description lists other permitted script hosts.

Bundle the page's own CSS, JavaScript, images, and data. Most pages need no library.

### Choose neutral colors

Choose neutrals to match the subject and accent color rather than defaulting to mid-gray. A slight hue tint can connect gray backgrounds to the accent. Pure white and near-black are also valid choices.

### Support the viewer's theme

The viewer has three theme states. Explicit light or dark sets `data-theme="light"` or `data-theme="dark"` on the root element. System mode sets no attribute and uses `prefers-color-scheme`.

Define theme tokens in this order:

1. Put the complete light palette on bare `:root`.
2. Redefine only tokens under `@media (prefers-color-scheme: dark)`, guarded by `:root:not([data-theme="light"])`. An explicit light choice must override a dark OS preference.
3. Redefine tokens under `:root[data-theme="dark"]` so explicit dark overrides a light OS preference.

For a dark-first design, swap light and dark consistently throughout this pattern. Style components with tokens, not directly inside media or `[data-theme]` blocks. A color defined only in a theme block is unavailable in the unstamped system state.

Set an explicit `body` background from a token. Otherwise the host's background shows through and may belong to the opposite theme. Every element's colors must use the same token set as its background. Avoid literal colors that work in only one theme.

Before publishing, check for colors defined only in theme blocks. Test contrast and accent colors in both themes; do not merely invert the palette.

An intentionally single-theme design, such as a neon arcade screen or letterpress invitation, may omit the media query and theme attributes. It must still set the background and every color explicitly so it works over either host background.

### Use layout for spacing

Use flex or grid with `gap` for sibling groups instead of margins that can collapse or double. Give tables, code blocks, and diagrams their own `overflow-x: auto` containers. The page body must not scroll sideways. Use `font-variant-numeric: tabular-nums` where digits align in columns.

### Avoid stock generated designs

Unless the user requests them, avoid these repeated defaults:

- Warm cream `#F4F1EA` with a serif display face and terracotta accent.
- Near-black with one acid-green or vermilion accent.
- Broadsheet hairline rules and dense columns.
- Purple-to-blue gradient heroes on white.
- Inter or Space Grotesk chosen without regard to the subject.
- Emoji section markers, centered layouts throughout, `rounded-lg` on every element, or accent rails on rounded cards.

Follow an explicit user direction even when it uses one of these styles.

### Check the rendered page

Inspect overlapping elements, cascade conflicts, and font fallbacks. Close non-void elements, double-quote attributes, provide visible keyboard focus, and respect `prefers-reduced-motion`. For generative or decorative graphics, prefer Canvas or WebGL over long hand-authored SVG paths.

Check selector specificity so component and section rules do not override each other's spacing.

### Write concrete copy

Name controls using terms readers recognize, such as "notifications" rather than "webhook config". Use active voice. A control should name its action, such as "Publish", and its success message should confirm it, such as "Published". Errors should explain the failure and how to fix it, without apologies or vague claims.

### Name the page

The `<title>` appears in the gallery and browser tab. Use a subject-specific noun phrase, usually two to four words, or the question the page answers. Do not append an explanation after a dash or colon. Put that explanation in the one-sentence publish `description`.

The name must distinguish the page from other artifacts. Remove generic greetings or category labels, not the identifying words. Do not shorten an already specific multi-word name until it becomes generic.

### Make structure meaningful

Use numbering only for actual sequences, ordered processes, or timelines. Labels, dividers, and other structural elements should communicate content relationships rather than decorate the page.

### Design tools for scanning and interaction

For dashboards and tools, show summaries before detail. Indicate state with shapes or labels as well as numbers. Keep success, warning, and critical colors separate from the accent palette. Give charts and sparklines readable fills, grids, and endpoints. Make interactive elements look interactive.

### Match charts to the data

Choose chart types that fit the data. Avoid scales or encodings that exaggerate differences, and title the finding rather than naming the axes. Load the `dataviz` skill for chart-specific guidance. This skill still governs the surrounding page.

## Design plan

Before writing code:

- Define four to six named hex colors.
- Choose typefaces for at least two roles, such as display and body. Add a utility face for captions or data when needed.
- Describe the layout in one or two sentences.

Use that plan for every color and type decision during implementation.

## When the request is editorial

Choose a distinctive visual direction based on the subject. Take one aesthetic risk when it improves the result.

Before building, revise any part of the plan that could fit an unrelated page unchanged. Record what changed and why, then implement the revised plan.

- Open with a subject-specific headline, image, demonstration, or interaction.
- Choose display and body faces for this page, with a clear type scale, weights, widths, and spacing.
- Use animation only when it supports the subject or interaction. Prefer a coordinated sequence to scattered effects, and omit animation when it adds no value.
- Match implementation detail to the direction. Minimal designs need precise spacing and typography; dense designs need enough work to remain readable.
- Concentrate emphasis in one area and keep surrounding elements subdued. If the accent conflicts with the background, adjust its hue toward the background or reduce saturation before replacing it.
