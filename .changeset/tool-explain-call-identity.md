---
"@stagefright5/pi-tool-explain": patch
---

Bind tool explanations to tool-call IDs so argument preparation cannot hide a generated label. Fix bash rows whose transcript contains `timeout: null` while execution receives no timeout field. Persist call bindings for session restoration, share pending summaries across equivalent calls, and retain bindings when reusing cached labels without another model request.
