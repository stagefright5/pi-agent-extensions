# @stagefright5/pi-tool-explain

## 0.1.0

### Minor Changes

- bd97d92: Explain all top-level tool calls by default. Add `/tool-explain` to choose tools and save the choices in Pi agent settings.

  Collapsed rows show a summary, timing, and errors. Expand a row to see the tool's original arguments and output, including edit diffs.

- bd97d92: Add Tool Explain. Collapsed `codemode` rows show a header and a compact status line (call counts, failures, timing) instead of the script and its output. The header has a different animation while the script is written, while it runs, and while its summary is generated. It then shows the full summary, which wraps rather than being cut off. The summary is drawn in the theme's accent color beside a muted label and is written by the cheapest available model from the session's provider, or by the model set in `toolExplain.model` in settings.

  Each failed nested call gets its own line under the header: the tool, the argument that identifies the call, and the tool's first error line, with bash exit codes added. The script's own error is always shown. Collapsed rows list up to three failed calls. Failure lines are dim and faint, and only the `✗` mark keeps the error color. Expanded rows keep the summary and failure lines above the full highlighted script and pi's full result. Summaries are saved in the session, so resumed sessions show them without new requests.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

- 8b0bcc5: Explain the native edit tool even though it owns its shell, preserving its expanded diff and respecting tool exclusions. Leave unknown self-owned renderers unchanged. Use consistent Calling, Running, completed, and failed headers across tools, with the tool name styled separately from the status text.
- fae8589: Return summaries through a structured `label` tool call with minimal reasoning, so a model's working notes never become the row summary. Remove the output token cap. Use one prompt and the same name/arguments/description input for every tool, including codemode scripts. A reply without a label marks the row as failed.
