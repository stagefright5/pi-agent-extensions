---
"@stagefright5/pi-side-agent": minor
---

Add `@stagefright5/pi-side-agent`: `/side` opens an independent, fully capable side agent in a right-hand Rex split. It starts from an immutable, verified copy of the active branch through the last completed turn (including compactions, context edits, and extension state), runs as its own Pi process and session with reconstructed configuration and tool/model validation, and can be closed and reopened. `/side send` (or the child-only `side_agent_send` tool for explicit user send requests) and `/side inbox` return an explicitly reviewed, attributed result to the main conversation without starting a model turn or importing it twice.
