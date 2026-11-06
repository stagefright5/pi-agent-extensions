---
"@stagefright5/pi-picker": patch
"@stagefright5/pi-extension-utils": patch
"@stagefright5/pi-dialog": patch
"@stagefright5/pi-bg-bash": patch
"@stagefright5/pi-plan-mode": patch
"@stagefright5/pi-prompt-truly-mine": patch
"@stagefright5/pi-prompt-history-search": patch
"@stagefright5/pi-side-agent": patch
"@stagefright5/pi-status-bar": patch
"@stagefright5/pi-tool-output-browser": patch
"@stagefright5/pi-tool-explain": patch
---

Use semantic theme backgrounds in shared picker, popup, and composer surfaces instead of deriving dark-only colors. Keep job, plan, and side-agent statuses uncolored in Pi's persistent storage and apply the active theme when the shared footer renders, with plain fallbacks for other footers. Include the updated vendored UI libraries in consuming extensions.
