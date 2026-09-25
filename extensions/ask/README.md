# Ask

Most of this extension was written with the pi agent CLI.

Adds `/ask` as an extension command that applies an ask-before-deciding policy to one task.

[Back to the extension workspace](../../README.md)

## Usage

Submit the command at the beginning of the prompt:

```text
/ask Implement the authentication flow
```

With Prompt Truly Mine installed, you can also insert the command after existing text. Prompt Truly Mine moves it to the beginning when you submit the draft:

```text
Implement the authentication flow /ask
```

The extension sends the command arguments to the agent with instructions to:

- ask before choosing among reasonable options
- ask about ambiguity, intent, edge cases, and tradeoffs
- ask before destructive, irreversible, or outward-facing actions
- use the agent's structured question tool when available
- verify code and filesystem facts before asking
- continue independent work before asking about blocked decisions

The extension normalizes quoted arguments using the same parsing rules as pi prompt templates. Calling `/ask` without arguments sends the policy by itself, as the previous prompt template did.

`/ask` remains a normal extension command. Prompt Truly Mine provides the optional inline autocomplete and promotion behavior described above.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-ask
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/ask` or expose it through the workspace's development symlink. Run `/reload` after source changes.

## Scope

The policy applies only to the task submitted through `/ask`. It does not enable a persistent mode or change later prompts.
