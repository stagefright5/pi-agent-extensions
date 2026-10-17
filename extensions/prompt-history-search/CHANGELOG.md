# @stagefright5/pi-prompt-history-search

## 0.2.0

### Minor Changes

- af36ea7: Keep autocomplete above the bottom-anchored composer while preserving native keyboard navigation, mouse hit testing, and selection styling. Document native symmetric character-cell padding.

  Update the composer layout with half-row padded draft and footer bars with vertically centred text, a colored mode rail in the left inset, an empty-draft placeholder, and a darker footer bar with the shell mode and `/ commands  ! shell  @ files` (replaced by `⌃Z undo  ⌃Y redo` after an undo). Redraw autocomplete as its own panel with a visible selection, aligned names, scope-tag-free word-boundary descriptions, and a position/key legend. Preserve the composer background when Pi clears the cursor cell on exit.

  Make fullscreen composer selection copy only draft source text, never the visual inset, soft-wrap breaks, chrome, or cursor. Support drag, double-click word, and triple-click line selection, and honor `fullscreenCopyOnSelect`.

  Record submitted slash commands in editor recall and, when both extensions are loaded, the local 30-day prompt-history search index. Capture built-in commands before dispatch without creating model messages, ignore completion-only selection, and drain pending history writes before search and orderly shutdown. Retain Up/Down history across `/reload`, `/new`, and session switches, and seed it from saved prompts across all projects on every session start, including fresh launches.

  Reference skills and prompt templates instead of prepending them: the request is sent first and unchanged, followed by a `<context-references>` list of files for the agent to read (template placeholders refer to the request). Leading `/skill:` and `/template` drafts are resubmitted without Pi's expansion so the request stays first.

- 895138b: Add `@stagefright5/pi-picker`: fast multi-word fuzzy search (word-start ranking, accent-insensitive, incremental narrowing, async slices for very large lists), highlighted lists, preview panes, filter chips, multi-select actions, and an inline suggestion panel. Extensions bundle pi-picker 0.1.0 under `vendor/` at stage time instead of depending on it at runtime.

  Prompt History Search moves `Alt+R` onto the picker: ranked search with highlights, a preview pane, filters (project/session, 24 hours/7 days, prompts/commands), multi-select insert, copy, and confirmed delete (persisted as tombstones so session rescans cannot restore deleted prompts). Recency now outweighs match position among equally good matches.

  Tool Output Browser gains ranked, highlighted search, an output preview, tool and error filters, and multi-select copy; marked results can be stepped through in the detail view.

  Prompt Truly Mine re-ranks composer suggestions with the shared engine and highlights the typed text in the suggestion panel.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- ebf86c0: Never overwrite prompt history from a different profile or from an unreadable index: each update resolves the index path once, and an unreadable index is kept as `index.json.unreadable-<time>` instead of being replaced.
- 065afe4: Show a prompt inserted from the Alt+R history picker in the composer immediately instead of after the next keypress. Picker filter rows start with `⌃F filter` and always show each filter's number key.
- 00fb29b: Align with pi 1.2.0: rebuild plan review on public TUI APIs with cancellable interactions and serialized transactional saves, account for every session usage category, and respect configured agent/session directories. Add strict SDK typechecking and regression coverage for workflow, narrow viewports, mouse dispatch, cancellation, and profile isolation.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
