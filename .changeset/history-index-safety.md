---
"@stagefright5/pi-prompt-history-search": patch
---

Never overwrite prompt history from a different profile or from an unreadable index: each update resolves the index path once, and an unreadable index is kept as `index.json.unreadable-<time>` instead of being replaced.
