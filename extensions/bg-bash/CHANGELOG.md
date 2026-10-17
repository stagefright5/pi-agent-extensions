# @stagefright5/pi-bg-bash

## 0.1.0

### Minor Changes

- 0e50cb4: Add `@stagefright5/pi-bg-bash`: replaces the `bash` tool so commands still running after `wait` seconds (default 10) continue as background jobs instead of blocking the agent. Quick commands return exactly as with the built-in tool. Adds `job_status`, `job_output`, `job_list`, and `job_kill`; a `bg-job` follow-up message when a job exits on its own; a footer indicator (`● 2 running · ○1 ○1`); and a `/jobs` manager (`Alt+J`) with live log previews, a full log view, kill, copy, and send-to-agent. Jobs survive `/reload` and stop on quit or session changes. Stopping a job from `/jobs` tells the agent ("stopped by the user"); `job_kill` stays silent. The jobs panel fits its content, up to half the terminal.

  Compact Status Bar: extension statuses can be made clickable through the shared status-line contract (`registerStatusAction`). Click them in fullscreen mode, or press `Alt+S` and use the arrows and `Enter`. The footer line is now laid out only when one of its inputs changes instead of on every frame.

  Prompt Truly Mine: clicks on a clickable status in the composer footer run its action without moving the caret.

  Pi Picker: `height` also accepts `{ max, min, fit }` (a fraction of the terminal, optionally shrinking to the items without resizing while typing). `previewKey` re-wraps live previews only when their text changes, and `previewTail` opens a preview at its end and follows new lines. Preview wrapping no longer re-splits the text for every line (a 300-line preview re-wraps in 0.75 ms instead of 2.5 ms), and cached previews skip match-range computation.

  All of these, and Tool Output Browser, now develop against pi 1.3.0.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- d87494b: Tell the agent in the bash tool description and prompt guidelines to verify the exit code with `job_status` before reporting success for a background command.
- 8b0bcc5: Always background bash commands still running after 10 seconds. Remove the agent-controlled `wait` argument and its prompt guidance, discard stale overrides, and enforce the fixed threshold even when execution bypasses argument preparation. The optional `timeout` still limits total runtime independently.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b3189e: Shorten documentation, remove narration-style comments, and use concrete wording in design guidance, Plan Mode prompts, and artifact validation messages. Preserve approval requirements, command behavior, and compatibility notes. Mark the edited design fundamentals as adapted from upstream rather than verbatim.
