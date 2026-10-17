# @stagefright5/pi-status-bar

## 0.4.0

### Added

- Share the status line with the focused Prompt Truly Mine composer, falling back to a separate footer when the composer cannot draw it.
- Support clickable extension statuses in fullscreen mode and keyboard actions through `Alt+S`.
- Include provider-reported usage from UI-owned summaries in the displayed cost, using durable custom usage entries.

### Fixed

- Restore accent-colored model statuses and legacy Fast-indicator placement.
- Account for session usage categories through shared status/usage contracts.
- Recompute footer layout only when an input changes rather than on every frame.

### Notes

- Pi's native session total does not include UI-only model calls through the public 1.3.0 API. Summary usage tracking is best-effort, not a billing ledger.

## 0.3.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Display OpenAI Fast mode as the text-style ⚡︎ glyph immediately after effort in the compact footer, without duplicating the generic extension status. Keep it attached to effort in shortened model labels and remove it when Fast mode is off.

## 0.2.1

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.2.0

### Minor changes

- 0987180: Show the active provider, model display name, and thinking level after session cost in the compact status bar.

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
