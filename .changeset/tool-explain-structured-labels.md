---
"@stagefright5/pi-tool-explain": patch
---

Return summaries through a structured `label` tool call with minimal reasoning, so a model's working notes never become the row summary. Remove the output token cap. Use one prompt and the same name/arguments/description input for every tool, including codemode scripts. A reply without a label marks the row as failed.
