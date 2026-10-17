---
"@stagefright5/pi-prompt-truly-mine": minor
---

Attach skills and prompt templates with `$name` (Codex-style) anywhere in the draft, with a `$` autocomplete menu. `/` is now for commands only: skills and templates leave the `/` menus, and submitting the retired `/skill:name` or a leading `/template` is blocked with a hint that keeps the draft. Only loaded names count as references (`$HOME`, `$1`, and prices stay literal). When a skill and a template share a name, the skill is used and a warning is shown. The composer footer hints now include `$ skills`.
