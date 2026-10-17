---
"@stagefright5/pi-prompt-truly-mine": minor
"@stagefright5/pi-prompt-history-search": minor
---

Keep autocomplete above the bottom-anchored composer while preserving native keyboard navigation, mouse hit testing, and selection styling. Document native symmetric character-cell padding.

Update the composer layout with half-row padded draft and footer bars with vertically centred text, a colored mode rail in the left inset, an empty-draft placeholder, and a darker footer bar with the shell mode and `/ commands  ! shell  @ files` (replaced by `⌃Z undo  ⌃Y redo` after an undo). Redraw autocomplete as its own panel with a visible selection, aligned names, scope-tag-free word-boundary descriptions, and a position/key legend. Preserve the composer background when Pi clears the cursor cell on exit.

Make fullscreen composer selection copy only draft source text, never the visual inset, soft-wrap breaks, chrome, or cursor. Support drag, double-click word, and triple-click line selection, and honor `fullscreenCopyOnSelect`.

Record submitted slash commands in editor recall and, when both extensions are loaded, the local 30-day prompt-history search index. Capture built-in commands before dispatch without creating model messages, ignore completion-only selection, and drain pending history writes before search and orderly shutdown. Retain Up/Down history across `/reload`, `/new`, and session switches, and seed it from saved prompts across all projects on every session start, including fresh launches.

Reference skills and prompt templates instead of prepending them: the request is sent first and unchanged, followed by a `<context-references>` list of files for the agent to read (template placeholders refer to the request). Leading `/skill:` and `/template` drafts are resubmitted without Pi's expansion so the request stays first.
