---
"@stagefright5/pi-codemode-explain": minor
---

Add Codemode Explain. Collapsed `codemode` rows show a header and a compact status line (call counts, failures, timing) instead of the script and its output. The header has a different animation while the script is written, while it runs, and while its summary is generated. It then shows the full summary, which wraps rather than being cut off. The summary is drawn in the theme's accent color beside a muted label and is written by the cheapest available model from the session's provider, or by the model set in `codemodeExplain.model` in settings.

Each failed nested call gets its own line under the header: the tool, the argument that identifies the call, and the tool's first error line, with bash exit codes added. The script's own error is always shown. Collapsed rows list up to three failed calls. Failure lines are dim and faint, and only the `✗` mark keeps the error color. Expanded rows keep the summary and failure lines above the full highlighted script and pi's full result. Summaries are saved in the session, so resumed sessions show them without new requests.
