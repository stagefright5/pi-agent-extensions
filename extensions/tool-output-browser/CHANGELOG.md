# @stagefright5/pi-tool-output-browser

## 0.2.0

### Minor Changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch Changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.

## 0.1.2

### Patch Changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
