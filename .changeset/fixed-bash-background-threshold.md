---
"@stagefright5/pi-bg-bash": patch
---

Always background bash commands still running after 10 seconds. Remove the agent-controlled `wait` argument and its prompt guidance, discard stale overrides, and enforce the fixed threshold even when execution bypasses argument preparation. The optional `timeout` still limits total runtime independently.
