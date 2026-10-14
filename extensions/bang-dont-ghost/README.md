# Bang Don't Ghost

Most of this extension was written with the pi agent CLI.

Automatically starts an agent follow-up after a user-entered single-`!` shell command finishes, instead of leaving the recorded result waiting for another prompt.

[Back to the extension workspace](../../README.md)

## Runtime requirement

Bang Don't Ghost requires Pi to emit a post-execution `user_bash_result` extension event after recording the matching `bashExecution` message. Stock Pi does not currently provide this event in its published extension API. The local patcher supports only the installed Pi 1.2.0 bundled runtime and fails closed for every other version or layout.

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

Without that runtime patch, the event never fires and the extension does nothing. There is no polling fallback.

## Patch command

This source checkout includes an idempotent patcher at `scripts/patch-pi-user-bash-result.mjs`. On this development machine, a command shim is installed at `~/.pi/agent/bin/pi-patch-user-bash-result` and invokes the versioned repository script.

Run it after `pi update`, after changing the active FNM Node installation, or whenever the patch may have been replaced:

```bash
pi-patch-user-bash-result
```

The command:

- requires Pi 1.2.0 and its bundled `dist/bundle/cli.js` layout
- resolves the active `pi` executable from `PATH`, including the current pnpm command shim
- locates the single bundled runtime chunk containing `AgentSession`
- accepts the exact current patch without rewriting the file
- patches both direct recording and deferred-result flushing after context refresh
- writes through a same-directory temporary file and runs `node --check` before an atomic rename
- leaves Pi unchanged, prints diagnostics, shows a macOS notification, and exits nonzero when the version, layout, or exact anchors differ

Run this command manually. Pi startup does not run it. Rerun it after reinstalling Pi 1.2.0. A newer Pi release requires a patcher update, and the patcher will not apply an older patch. The patcher and command shim are development tools and are not included in the published npm package.

Restart pi after applying the runtime patch. `/reload` reloads extension code, not the already-loaded bundled runtime.

Verify or roll back without guessing at runtime contents:

```bash
pi-patch-user-bash-result --check    # read-only; nonzero if missing or incompatible
pi-patch-user-bash-result --restore  # restore the saved, exact original runtime
```

The patcher keeps `<runtime.js>.bang-dont-ghost.original`. Restoration refuses to overwrite a runtime changed by another patch or update. For an explicit Pi 1.2.0 bundled test target, the script also accepts `--target <runtime.js>`. Tests validate direct/deferred event ordering against the installed 1.2.0 bundle, not just a synthetic fixture.

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
- Pi's follow-up queue delivers commands completed while the agent is busy
- LLM-initiated `bash` tool calls are unaffected
- the extension uses no timer, session-entry scan, command tracker, or command-text correlation

The extension has no slash command or configuration; installing it enables the behavior. Every eligible command starts a model-provider request, which may incur usage charges.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-bang-dont-ghost
```

<!-- package-tools:install:end -->

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

The extension declares a typed module augmentation for the event added by this patch; it does not cast `pi.on` or claim the event exists in stock pi. Remove that augmentation when pi publishes an equivalent completion event.
