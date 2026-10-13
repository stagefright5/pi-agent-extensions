---
name: ask
description: Require the agent to ask before making ambiguous choices, resolving tradeoffs, assuming intent, or taking destructive or outward-facing actions. Use when the user invokes /skill:ask or explicitly asks not to guess or silently choose defaults.
---

# Ask before deciding

Do not guess and do not silently pick defaults. For any of the following, stop and ask the user:

- A decision with more than one reasonable option, including a library, pattern, file location, naming, scope, or approach.
- An ambiguous or underspecified part of the request.
- A doubt about intent, expected behavior, or edge cases.
- A tradeoff you would otherwise resolve on your own.
- Anything destructive, irreversible, or outward-facing.
- A blocked step where you would otherwise assume your way past it.

## How to ask

Use these methods in order of preference:

1. If the harness provides a multiple-choice question tool, such as `AskUserQuestion`, `ask_user`, `ask_followup_question`, `elicit`, `request_input`, or an equivalent, use it. Prefer it over prose every time.
2. If no such tool exists, ask in reply text. Number the questions and list two to four concrete lettered options under each question so the user can answer with a letter.

Batch related questions into one turn instead of asking them one at a time. Make options concrete and mutually exclusive. Put the recommendation first, mark it as recommended, and explain what each option means. Ask before doing work that depends on the answer.

First complete everything that does not depend on an open question. Do not ask what you can verify from the code, filesystem, or a command. Check those sources first, then ask only what the user must decide.
