# Ask

<!-- prettier-ignore -->
DISCLAIMER: This is *mostly* vibe-coded using pi agent cli

Adds `/ask` as an extension command that applies an ask-before-deciding policy to one task.

[Back to the extension workspace](../../README.md)

## Usage

Submit the command at the beginning of the prompt:

```text
/ask Implement the authentication flow
```

With Prompt Truly Mine installed, it can also be inserted after existing text and is promoted when the draft is submitted:

```text
Implement the authentication flow /ask
```

The extension sends the command arguments to the agent with instructions to:

- ask before choosing among reasonable options
- ask about ambiguity, intent, edge cases, and tradeoffs
- ask before destructive, irreversible, or outward-facing actions
- use the harness's structured question tool when available
- verify code and filesystem facts before asking
- continue independent work before asking about blocked decisions

Quoted arguments are normalized using the same simple parsing behavior as pi prompt templates. Calling `/ask` without arguments retains the previous prompt-template behavior and sends the policy by itself.

`/ask` remains a normal extension command. Prompt Truly Mine provides the optional inline autocomplete and promotion behavior described above.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-ask
```

For source development, load this directory with `pi -e ./extensions/ask` or expose it through the workspace's development symlink. Run `/reload` after source changes.

## Scope

The policy applies only to the task submitted through `/ask`. It does not enable a persistent mode or change later prompts.
