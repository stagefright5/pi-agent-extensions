---
"@stagefright5/pi-bg-bash": patch
"@stagefright5/pi-obsidian-ui": patch
"@stagefright5/pi-openai-fast": patch
"@stagefright5/pi-plan-mode": patch
"@stagefright5/pi-prompt-history-search": patch
"@stagefright5/pi-prompt-truly-mine": patch
"@stagefright5/pi-provider-url-logger": patch
"@stagefright5/pi-status-bar": patch
"@stagefright5/pi-tool-explain": patch
"@stagefright5/pi-tool-output-browser": patch
"@stagefright5/pi-picker": patch
"@stagefright5/pi-extension-utils": minor
---

Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.
