---
"@stagefright5/pi-bg-bash": patch
"@stagefright5/pi-status-bar": patch
"@stagefright5/pi-plan-mode": patch
"@stagefright5/pi-tool-explain": patch
"@stagefright5/pi-prompt-history-search": patch
"@stagefright5/pi-provider-url-logger": patch
"@stagefright5/pi-tool-output-browser": patch
"@stagefright5/pi-extension-utils": patch
---

Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
