# @stagefright5/pi-side-agent

## 0.1.0

### Minor Changes

- 8de87bf: Add `@stagefright5/pi-side-agent`: `/side` opens an independent, fully capable side agent in a right-hand Rex split. It starts from an immutable, verified copy of the active branch through the last completed turn (including compactions, context edits, and extension state), runs as its own Pi process and session with reconstructed configuration and tool/model validation, and can be closed and reopened. `/side send` (or the child-only `side_agent_send` tool for explicit user send requests) and `/side inbox` return an explicitly reviewed, attributed result to the main conversation without starting a model turn or importing it twice.

### Patch Changes

- 426fdf0: Use semantic theme backgrounds in shared picker, popup, and composer surfaces instead of deriving dark-only colors. Keep job, plan, and side-agent statuses uncolored in Pi's persistent storage and apply the active theme when the shared footer renders, with plain fallbacks for other footers. Include the updated vendored UI libraries in consuming extensions.
