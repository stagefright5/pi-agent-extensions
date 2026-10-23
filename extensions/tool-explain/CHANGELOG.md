# @stagefright5/pi-tool-explain

## 0.2.0

### Minor Changes

- e6f91bf: `/tool-explain` opens as a framed pi-dialog popup with a subtitle that summarizes the current selection.

## 0.1.1

### Patch Changes

- 35e3d62: Bind tool explanations to tool-call IDs so argument preparation cannot hide a generated label. Fix bash rows whose transcript contains `timeout: null` while execution receives no timeout field. Persist call bindings for session restoration, share pending summaries across equivalent calls, and retain bindings when reusing cached labels without another model request.

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
