# @stagefright5/pi-prompt-truly-mine

## 0.4.0

### Minor Changes

- 0e50cb4: Add `@stagefright5/pi-bg-bash`: replaces the `bash` tool so commands still running after `wait` seconds (default 10) continue as background jobs instead of blocking the agent. Quick commands return exactly as with the built-in tool. Adds `job_status`, `job_output`, `job_list`, and `job_kill`; a `bg-job` follow-up message when a job exits on its own; a footer indicator (`● 2 running · ○1 ○1`); and a `/jobs` manager (`Alt+J`) with live log previews, a full log view, kill, copy, and send-to-agent. Jobs survive `/reload` and stop on quit or session changes. Stopping a job from `/jobs` tells the agent ("stopped by the user"); `job_kill` stays silent. The jobs panel fits its content, up to half the terminal.

  Compact Status Bar: extension statuses can be made clickable through the shared status-line contract (`registerStatusAction`). Click them in fullscreen mode, or press `Alt+S` and use the arrows and `Enter`. The footer line is now laid out only when one of its inputs changes instead of on every frame.

  Prompt Truly Mine: clicks on a clickable status in the composer footer run its action without moving the caret.

  Pi Picker: `height` also accepts `{ max, min, fit }` (a fraction of the terminal, optionally shrinking to the items without resizing while typing). `previewKey` re-wraps live previews only when their text changes, and `previewTail` opens a preview at its end and follows new lines. Preview wrapping no longer re-splits the text for every line (a 300-line preview re-wraps in 0.75 ms instead of 2.5 ms), and cached previews skip match-range computation.

  All of these, and Tool Output Browser, now develop against pi 1.3.0.

- af36ea7: Keep autocomplete above the bottom-anchored composer while preserving native keyboard navigation, mouse hit testing, and selection styling. Document native symmetric character-cell padding.

  Update the composer layout with half-row padded draft and footer bars with vertically centred text, a colored mode rail in the left inset, an empty-draft placeholder, and a darker footer bar with the shell mode and `/ commands  ! shell  @ files` (replaced by `⌃Z undo  ⌃Y redo` after an undo). Redraw autocomplete as its own panel with a visible selection, aligned names, scope-tag-free word-boundary descriptions, and a position/key legend. Preserve the composer background when Pi clears the cursor cell on exit.

  Make fullscreen composer selection copy only draft source text, never the visual inset, soft-wrap breaks, chrome, or cursor. Support drag, double-click word, and triple-click line selection, and honor `fullscreenCopyOnSelect`.

  Record submitted slash commands in editor recall and, when both extensions are loaded, the local 30-day prompt-history search index. Capture built-in commands before dispatch without creating model messages, ignore completion-only selection, and drain pending history writes before search and orderly shutdown. Retain Up/Down history across `/reload`, `/new`, and session switches, and seed it from saved prompts across all projects on every session start, including fresh launches.

  Reference skills and prompt templates instead of prepending them: the request is sent first and unchanged, followed by a `<context-references>` list of files for the agent to read (template placeholders refer to the request). Leading `/skill:` and `/template` drafts are resubmitted without Pi's expansion so the request stays first.

- eb21df5: Fold the status line into the composer footer. Compact Status Bar now lends its line through a shared global key, and the focused Prompt Truly Mine composer draws it in a single-row footer bar as `<dir · branch>  <mode>  <hints> · <statuses> … model · context · cost`, so Pi's separate footer row disappears. Whenever the composer is unfocused or cannot draw it, the status bar shows its own row again. The draft bar has a full padding row above and below and sits directly on the one-row footer (no half-block glyphs remain), footer text uses lower contrast against its bar, the `Ask Pi anything` placeholder is gone, and input hints (`/ commands  $ skills  ! shell  @ files`) show right-aligned in the empty draft row.
- a17a36c: Attach skills and prompt templates with `$name` (Codex-style) anywhere in the draft, with a `$` autocomplete menu. `/` is now for commands only: skills and templates leave the `/` menus, and submitting the retired `/skill:name` or a leading `/template` is blocked with a hint that keeps the draft. Only loaded names count as references (`$HOME`, `$1`, and prices stay literal). When a skill and a template share a name, the skill is used and a warning is shown. The composer footer hints now include `$ skills`.
- 895138b: Add `@stagefright5/pi-picker`: fast multi-word fuzzy search (word-start ranking, accent-insensitive, incremental narrowing, async slices for very large lists), highlighted lists, preview panes, filter chips, multi-select actions, and an inline suggestion panel. Extensions bundle pi-picker 0.1.0 under `vendor/` at stage time instead of depending on it at runtime.

  Prompt History Search moves `Alt+R` onto the picker: ranked search with highlights, a preview pane, filters (project/session, 24 hours/7 days, prompts/commands), multi-select insert, copy, and confirmed delete (persisted as tombstones so session rescans cannot restore deleted prompts). Recency now outweighs match position among equally good matches.

  Tool Output Browser gains ranked, highlighted search, an output preview, tool and error filters, and multi-select copy; marked results can be stepped through in the detail view.

  Prompt Truly Mine re-ranks composer suggestions with the shared engine and highlights the typed text in the suggestion panel.

### Patch Changes

- ce86e10: Fix a notch at the composer's left edge: the mode rail now marks only the draft rows, so the half-row edge between the draft and the footer is one clean line.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.
- 2cda9e3: Preserve large-paste payloads through undo, redo, draft replacement, and editor factory handoffs. Record asynchronous and mouse autocomplete edits, respect cursor-movement undo boundaries, and clear history for remapped submission. Isolate runtime-validated editor compatibility helpers, prevent slash paths from invoking inline commands, and avoid wide-character crashes in extremely narrow composers.

  Keep read continuation and oversized-line recovery notices visible in collapsed Obsidian tool output, and bound expanded native renderers to the actual viewport width. Add real extension-runner, read-tool, host-renderer, theme-switching, image-delivery, and editor lifecycle regressions without changing the shared composer/theme palette.

- 947b56f: Preserve attached images when promoting inline extension commands, including queued steering and follow-up messages. Derive the editor factory type from the public pi 1.2.0 UI API instead of importing an unexported SDK type.
- 11a2630: Match the prompt composer to sent user messages using shared theme surface/text tokens, and distinguish their dark cool-charcoal background from near-black blue-charcoal tool calls. Keep the Obsidian + Ice palette dark rather than using medium-gray cards. Remove composer rules in favor of a clean fill with top-right hints and blank bottom padding. Preserve native editor rows, cursor markers, autocomplete styles, and prefix-free content. Verify surface differentiation and text/indicator contrast in truecolor and 256-color output.

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
