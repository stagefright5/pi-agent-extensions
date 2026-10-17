# @stagefright5/pi-tool-output-browser

## 0.3.0

### Minor Changes

- 895138b: Add `@stagefright5/pi-picker`: fast multi-word fuzzy search (word-start ranking, accent-insensitive, incremental narrowing, async slices for very large lists), highlighted lists, preview panes, filter chips, multi-select actions, and an inline suggestion panel. Extensions bundle pi-picker 0.1.0 under `vendor/` at stage time instead of depending on it at runtime.

  Prompt History Search moves `Alt+R` onto the picker: ranked search with highlights, a preview pane, filters (project/session, 24 hours/7 days, prompts/commands), multi-select insert, copy, and confirmed delete (persisted as tombstones so session rescans cannot restore deleted prompts). Recency now outweighs match position among equally good matches.

  Tool Output Browser gains ranked, highlighted search, an output preview, tool and error filters, and multi-select copy; marked results can be stepped through in the detail view.

  Prompt Truly Mine re-ranks composer suggestions with the shared engine and highlights the typed text in the suggestion panel.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- 0e50cb4: Add `@stagefright5/pi-bg-bash`: replaces the `bash` tool so commands still running after `wait` seconds (default 10) continue as background jobs instead of blocking the agent. Quick commands return exactly as with the built-in tool. Adds `job_status`, `job_output`, `job_list`, and `job_kill`; a `bg-job` follow-up message when a job exits on its own; a footer indicator (`● 2 running · ○1 ○1`); and a `/jobs` manager (`Alt+J`) with live log previews, a full log view, kill, copy, and send-to-agent. Jobs survive `/reload` and stop on quit or session changes. Stopping a job from `/jobs` tells the agent ("stopped by the user"); `job_kill` stays silent. The jobs panel fits its content, up to half the terminal.

  Compact Status Bar: extension statuses can be made clickable through the shared status-line contract (`registerStatusAction`). Click them in fullscreen mode, or press `Alt+S` and use the arrows and `Enter`. The footer line is now laid out only when one of its inputs changes instead of on every frame.

  Prompt Truly Mine: clicks on a clickable status in the composer footer run its action without moving the caret.

  Pi Picker: `height` also accepts `{ max, min, fit }` (a fraction of the terminal, optionally shrinking to the items without resizing while typing). `previewKey` re-wraps live previews only when their text changes, and `previewTail` opens a preview at its end and follows new lines. Preview wrapping no longer re-splits the text for every line (a 300-line preview re-wraps in 0.75 ms instead of 2.5 ms), and cached previews skip match-range computation.

  All of these, and Tool Output Browser, now develop against pi 1.3.0.

- 065afe4: Show a prompt inserted from the Alt+R history picker in the composer immediately instead of after the next keypress. Picker filter rows start with `⌃F filter` and always show each filter's number key.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.

## 0.2.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
