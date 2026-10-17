# @stagefright5/pi-prompt-truly-mine

## 0.4.0

### Added

- Reference loaded skills and prompt templates with `$name` and a dedicated autocomplete menu. Send the request first and unchanged, followed by file references for the agent to read.
- Rank and highlight autocomplete suggestions with the shared picker engine.
- Include submitted slash commands in editor recall and, with Prompt History Search loaded, its local search index. Preserve recall across reloads and session changes.
- Add draft-only fullscreen mouse selection, including word/line selection and copy-on-select.
- Draw the shared status line in the composer footer and support clickable extension statuses without moving the caret.

### Changed

- Reserve `/` for commands. Retired `/skill:name` and leading template commands keep the draft and show a migration hint. Unknown dollar names remain literal; skills take precedence over same-name templates with a warning.
- Use full padding rows around the draft, a single-row footer, a draft-only mode rail, and right-aligned empty-draft hints. Keep autocomplete above the composer.

### Fixed

- Preserve large pasted content, attached images, cursor positions, and undo/redo across command promotion, queued messages, draft replacement, and editor handoffs.
- Record asynchronous and mouse autocomplete edits; respect cursor-movement undo boundaries and remapped submission.
- Prevent slash paths from invoking commands and handle wide characters in narrow composers.
- Preserve the composer background on exit and keep shared surface/text colors distinct from tool calls.

## 0.3.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.

## 0.2.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.2.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.

## 0.2.0

### Minor changes

- aed6ce5: Include extension commands in inline slash autocomplete and dispatch the first referenced command. Preserve the complete draft, including its inline command verb.
