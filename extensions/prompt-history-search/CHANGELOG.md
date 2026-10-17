# @stagefright5/pi-prompt-history-search

## 0.2.0

### Added

- Move `Alt+R` to the shared picker with ranked, highlighted search, prompt previews, and project/session, time-window, and prompt/command filters.
- Add multi-select insert, copy, and confirmed deletion. Persist deletion tombstones so rescanning sessions does not restore deleted entries.
- Index submitted slash commands when Prompt Truly Mine is loaded, and supply saved prompts for editor recall.

### Fixed

- Prefer recency among equally ranked matches and redraw the composer immediately after inserting a prompt.
- Explain picker filter shortcuts with numbered keys and a visible `Ctrl+F` hint.
- Keep index I/O off submission, serialize cross-process updates, and drain pending writes before search and orderly shutdown.
- Respect configured agent/session directories and resolve each update's index path once. Preserve unreadable indexes rather than overwriting them or another profile's history.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
