# Bang Don't Ghost

<!-- prettier-ignore -->
DISCLAIMER: This is *mostly* vibe-coded using pi agent cli

Automatically starts an agent follow-up after a user-entered single-`!` shell command finishes, instead of leaving the recorded result waiting for another prompt.

[Back to the extension workspace](../../README.md)

## Runtime requirement

Bang Don't Ghost requires Pi to emit a post-execution `user_bash_result` extension event after the matching `bashExecution` message has been recorded. Pi 0.84.2 does not provide this event in its published extension API; this branch targets the experimental local Pi patch that adds it.

The expected runtime payload is:

```ts
interface UserBashResultEvent {
  type: "user_bash_result";
  command: string;
  excludeFromContext: boolean;
  result: {
    output: string;
    exitCode: number | undefined;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string;
  };
}
```

Without that runtime patch, the event never fires and the extension does nothing. There is deliberately no polling fallback.

## Patch command

This source checkout includes an idempotent patcher at `scripts/patch-pi-user-bash-result.mjs`. On this development machine, a command shim is installed at `~/.pi/agent/bin/pi-patch-user-bash-result` and invokes the versioned repository script.

Run it after `pi update`, after changing the active FNM Node installation, or whenever the patch may have been replaced:

```bash
pi-patch-user-bash-result
```

The command:

- resolves the active `pi` executable from `PATH`
- accepts an already-applied patch without rewriting the file
- attempts exact-anchor patching on any installed Pi version
- patches both direct recording and deferred-result flushing
- writes through a same-directory temporary file and runs `node --check` before an atomic rename
- leaves Pi unchanged, prints diagnostics, shows a macOS notification, and exits nonzero when validation or patching fails

This is a manual command, not a Pi startup wrapper. Normal Pi startup does not automatically run it. The patcher and command shim are development-source automation and are not included in the published npm package.

For an explicit test target, the repository script also accepts `--target <agent-session.js>`.

## Usage

Run a normal single-bang command:

```text
!npm test
```

Pi records the command and output in model context, then emits `user_bash_result`. Bang Don't Ghost responds by submitting an empty, non-displayed custom message that starts the next agent turn. It does not copy the command or output into a second message.

Behavior:

- successful and nonzero command results start a follow-up
- user-cancelled commands do not start a follow-up
- `!!command` results do not start a follow-up
- commands completed while the agent is busy are delivered through Pi's follow-up queue
- LLM-initiated `bash` tool calls are unaffected
- no timer, session-entry scan, command tracker, or command-text correlation is used

The extension has no slash command or configuration; installing it enables the behavior. Every eligible command starts a model-provider request, which may incur usage charges.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-bang-dont-ghost
```

For source development, load this directory with `pi -e ./extensions/bang-dont-ghost` or expose it through the workspace's development symlink. Run `/reload` after source changes.

## Event flow

```text
user enters !command
        │
        ▼
Pi executes through its selected local/custom backend
        │
        ▼
Pi records bashExecution with command and output
        │
        ▼
Pi emits user_bash_result
        │
        ▼
Bang Don't Ghost skips !! and cancelled results
        │
        ▼
empty hidden message, deliverAs: followUp, triggerTurn: true
        │
        ▼
next agent turn
```

The local event type and one isolated `pi.on` cast can be removed when Pi publishes `user_bash_result` in its TypeScript declarations.
