# @stagefright5/pi-status-bar

## 0.4.0

### Minor Changes

- 0e50cb4: Add `@stagefright5/pi-bg-bash`: replaces the `bash` tool so commands still running after `wait` seconds (default 10) continue as background jobs instead of blocking the agent. Quick commands return exactly as with the built-in tool. Adds `job_status`, `job_output`, `job_list`, and `job_kill`; a `bg-job` follow-up message when a job exits on its own; a footer indicator (`● 2 running · ○1 ○1`); and a `/jobs` manager (`Alt+J`) with live log previews, a full log view, kill, copy, and send-to-agent. Jobs survive `/reload` and stop on quit or session changes. Stopping a job from `/jobs` tells the agent ("stopped by the user"); `job_kill` stays silent. The jobs panel fits its content, up to half the terminal.

  Compact Status Bar: extension statuses can be made clickable through the shared status-line contract (`registerStatusAction`). Click them in fullscreen mode, or press `Alt+S` and use the arrows and `Enter`. The footer line is now laid out only when one of its inputs changes instead of on every frame.

  Prompt Truly Mine: clicks on a clickable status in the composer footer run its action without moving the caret.

  Pi Picker: `height` also accepts `{ max, min, fit }` (a fraction of the terminal, optionally shrinking to the items without resizing while typing). `previewKey` re-wraps live previews only when their text changes, and `previewTail` opens a preview at its end and follows new lines. Preview wrapping no longer re-splits the text for every line (a 300-line preview re-wraps in 0.75 ms instead of 2.5 ms), and cached previews skip match-range computation.

  All of these, and Tool Output Browser, now develop against pi 1.3.0.

- eb21df5: Fold the status line into the composer footer. Compact Status Bar now lends its line through a shared global key, and the focused Prompt Truly Mine composer draws it in a single-row footer bar as `<dir · branch>  <mode>  <hints> · <statuses> … model · context · cost`, so Pi's separate footer row disappears. Whenever the composer is unfocused or cannot draw it, the status bar shows its own row again. The draft bar has a full padding row above and below and sits directly on the one-row footer (no half-block glyphs remain), footer text uses lower contrast against its bar, the `Ask Pi anything` placeholder is gone, and input hints (`/ commands  $ skills  ! shell  @ files`) show right-aligned in the empty draft row.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- 00fb29b: Align with pi 1.2.0: rebuild plan review on public TUI APIs with cancellable interactions and serialized transactional saves, account for every session usage category, and respect configured agent/session directories. Add strict SDK typechecking and regression coverage for workflow, narrow viewports, mouse dispatch, cancellation, and profile isolation.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.

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
