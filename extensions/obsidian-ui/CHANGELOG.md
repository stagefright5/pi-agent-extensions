# Changelog

## 0.2.1

### Patch Changes

- 947b56f: Fix pi 1.2.0 SDK type compatibility by treating native renderer callbacks as opaque identities when comparing them, rather than requiring incompatible callable renderer signatures. Preserve existing renderer selection and custom-renderer behavior without unsafe API casts.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.
- 2cda9e3: Preserve large-paste payloads through undo, redo, draft replacement, and editor factory handoffs. Record asynchronous and mouse autocomplete edits, respect cursor-movement undo boundaries, and clear history for remapped submission. Isolate runtime-validated editor compatibility helpers, prevent slash paths from invoking inline commands, and avoid wide-character crashes in extremely narrow composers.

  Keep read continuation and oversized-line recovery notices visible in collapsed Obsidian tool output, and bound expanded native renderers to the actual viewport width. Add real extension-runner, read-tool, host-renderer, theme-switching, image-delivery, and editor lifecycle regressions without changing the shared composer/theme palette.

- 11a2630: Match the prompt composer to sent user messages using shared theme surface/text tokens, and distinguish their dark cool-charcoal background from near-black blue-charcoal tool calls. Keep the Obsidian + Ice palette dark rather than using medium-gray cards. Remove composer rules in favor of a clean fill with top-right hints and blank bottom padding. Preserve native editor rows, cursor markers, autocomplete styles, and prefix-free content. Verify surface differentiation and text/indicator contrast in truecolor and 256-color output.
- 3330a53: Keep the tool box background behind cut tool-row labels. A long `plan_output` title, or a long compact tool header, no longer ends its background where the `…` starts.

## 0.2.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.
