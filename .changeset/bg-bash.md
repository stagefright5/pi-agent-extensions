---
"@stagefright5/pi-bg-bash": minor
"@stagefright5/pi-status-bar": minor
"@stagefright5/pi-prompt-truly-mine": minor
"@stagefright5/pi-picker": minor
"@stagefright5/pi-tool-output-browser": patch
---

Add `@stagefright5/pi-bg-bash`: replaces the `bash` tool so commands still running after `wait` seconds (default 10) continue as background jobs instead of blocking the agent. Quick commands return exactly as with the built-in tool. Adds `job_status`, `job_output`, `job_list`, and `job_kill`; a `bg-job` follow-up message when a job exits on its own; a footer indicator (`● 2 running · ○1 ○1`); and a `/jobs` manager (`Alt+J`) with live log previews, a full log view, kill, copy, and send-to-agent. Jobs survive `/reload` and stop on quit or session changes. Stopping a job from `/jobs` tells the agent ("stopped by the user"); `job_kill` stays silent. The jobs panel fits its content, up to half the terminal.

Compact Status Bar: extension statuses can be made clickable through the shared status-line contract (`registerStatusAction`). Click them in fullscreen mode, or press `Alt+S` and use the arrows and `Enter`. The footer line is now laid out only when one of its inputs changes instead of on every frame.

Prompt Truly Mine: clicks on a clickable status in the composer footer run its action without moving the caret.

Pi Picker: `height` also accepts `{ max, min, fit }` (a fraction of the terminal, optionally shrinking to the items without resizing while typing). `previewKey` re-wraps live previews only when their text changes, and `previewTail` opens a preview at its end and follows new lines. Preview wrapping no longer re-splits the text for every line (a 300-line preview re-wraps in 0.75 ms instead of 2.5 ms), and cached previews skip match-range computation.

All of these, and Tool Output Browser, now develop against pi 1.3.0.
