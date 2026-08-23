# Bang Don't Ghost

<!-- prettier-ignore -->
DISCLAIMER: This is *mostly* vibe-coded using pi agent cli

Automatically starts an agent follow-up after a user-entered single-`!` shell command finishes, instead of leaving the recorded result waiting for another prompt.

[Back to the extension workspace](../../README.md)

## Usage

Run a normal single-bang command:

```text
!npm test
```

Pi already records this command and its output in model context. After the result is recorded, Bang Don't Ghost submits an empty, non-displayed custom message that starts the next agent turn. It does not copy the command output into a second message.

Behavior:

- successful and nonzero command results start a follow-up
- user-cancelled commands do not start a follow-up
- `!!command` remains excluded from model context and does not start a follow-up
- commands completed while the agent is busy are delivered through Pi's follow-up queue
- LLM-initiated `bash` tool calls are unaffected

The extension has no slash command or configuration; installing it enables the behavior. Every eligible command starts a model-provider request, which may incur usage charges.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-bang-dont-ghost
```

For source development, load this directory with `pi -e ./extensions/bang-dont-ghost` or expose it through the workspace's development symlink. Run `/reload` after source changes.

## Compatibility and limitations

Bang Don't Ghost observes newly recorded `bashExecution` session entries instead of replacing shell execution. This preserves Pi's configured shell backend and remains compatible with extensions that route `!` commands to SSH, sandboxes, or other environments.

Pi's public extension API does not expose a bare “run the agent again” operation, so the extension uses an empty hidden custom message with `triggerTurn: true`. Providers that reject an empty final message may not support this approach consistently.

If a shell backend throws before Pi records a `bashExecution` result, there is no result to trigger a follow-up.
