# @stagefright5/pi-tool-explain

## 0.1.0

### Added

- Explain all top-level tool calls by default. Use `/tool-explain` to choose tools and persist the selection separately from Pi's settings.
- Show summaries, timing, and errors in collapsed rows; retain original arguments, output, and native edit diffs when expanded.
- Summarize codemode calls with call/failure counts, timings, and details for up to three failed nested calls. Save summaries in the session for reuse after resume.
- Select a low-cost model from the session's provider or use the configured summary model. Track provider-reported summary usage.

### Fixed

- Obtain summary text through a structured `label` tool call with minimal reasoning so working notes cannot become the row label. Remove the output-token cap; a reply without a label marks the summary as failed.
- Use consistent calling, running, completed, and failed headers. Preserve unknown self-owned renderers and configured exclusions.
- Guard delayed notifications and usage recording across cancellation and session shutdown; skip unconfigured summaries when no current model exists.
