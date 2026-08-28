# Why Polling Existed

See https://github.com/earendil-works/pi/issues/8530

> Historical design note: Bang Don't Ghost no longer polls on this branch. It now requires the experimental `user_bash_result` Pi event described below.

## Original gap

Pi 0.84.2–0.84.3 publish a pre-execution `user_bash` hook:

```text
user enters !command
        │
        ▼
user_bash event
        │
        ▼
shell execution
        │
        ▼
bashExecution result recorded
```

The original extension needed to start a new agent turn only after the final `bashExecution` message was available in model context. There was no published completion hook at that point.

```text
user enters !command
        │
        ▼
user_bash event
        │
        ▼
shell execution
        │
        ▼
bashExecution result recorded
        │
        ▼
user_bash_result event       ← missing from published Pi 0.84.2–0.84.3
```

## Why interception was not enough

A `user_bash` handler can return custom `BashOperations` or a complete replacement result. Using that capability only to observe completion would make Bang Don't Ghost an execution backend.

```text
                         ┌── local shell
user_bash interception ──┼── SSH extension
                         ├── sandbox extension
                         └── container extension
```

Pi uses the first `user_bash` handler that returns a result. Taking that slot could prevent another extension from routing the command. Reimplementing execution would also have to preserve Pi's configured shell, command prefix, streaming, timeout, cancellation, truncation, and process-tree behavior.

The extension therefore returned nothing from `user_bash` and observed Pi's common recorded result instead.

## Historical polling workaround

The old implementation remembered each single-`!` command and scanned session entries until a matching `bashExecution` appeared.

```text
User                 Pi                  Extension
 │                    │                      │
 │ !npm test          │                      │
 ├───────────────────►│                      │
 │                    │ user_bash            │
 │                    ├─────────────────────►│
 │                    │                      │ remember command
 │                    │◄─────────────────────┤ return undefined
 │                    │                      │
 │                    │ execute command      │ poll every 50 ms
 │                    │───────────────┐      │
 │                    │◄──────────────┘      │
 │                    │ record result        │
 │                    │                      │
 │                    │                      │ find matching entry
 │                    │◄─────────────────────┤ trigger follow-up
```

The tracker stored:

```text
┌────────────────────────────────────────────────┐
│ nextEntryIndex                                 │
│   Index of the first session entry not scanned │
├────────────────────────────────────────────────┤
│ pendingCommands                                │
│   Command strings awaiting matching results    │
└────────────────────────────────────────────────┘
```

Each scan advanced `nextEntryIndex` to the session snapshot's current length, regardless of whether an entry matched:

```text
entries:          [E0] [E1] [E2] [E3]
nextEntryIndex:                         4
pendingCommands:  ["echo hello"]

unrelated E4 arrives
scan E4, ignore it
nextEntryIndex:                              5
pendingCommands:  ["echo hello"]

matching E5 arrives
scan E5, consume pending command
nextEntryIndex:                                   6
pendingCommands:  []
```

Pending commands controlled whether the timer continued. A matching, non-cancelled entry triggered its follow-up immediately; the extension did not wait for every pending command to finish.

## Problems with the workaround

### Missing result could poll forever

If a backend threw before recording `bashExecution`, no completion signal existed. The timer remained active until session shutdown.

### Correlation used command text

`user_bash` did not provide an execution ID shared with the later session entry. Exact command text and pending order were the only available correlation keys.

### Polling had recurring overhead

While any command was pending, the extension called `sessionManager.getEntries()` every 50 ms. A cursor avoided reprocessing old entries, but retrieving the entry list still had a cost.

### Lifecycle code obscured the behavior

The extension needed timer ownership, session-start reset, session-shutdown cleanup, pending-command state, entry filtering, and cancellation handling for one conceptual action: react after a shell result.

## Replacement: `user_bash_result`

The experimental Pi patch emits a notification after the matching `bashExecution` message has been appended:

```text
user enters !command
        │
        ▼
Pi executes through the selected backend
        │
        ▼
Pi appends bashExecution
        │
        ▼
Pi emits user_bash_result
        │
        ▼
Bang Don't Ghost handles the final result directly
```

Expected payload:

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

The event must be emitted only after the result is available in session and model context. It should cover:

- TUI and RPC user-bash paths
- Pi's local backend
- extension-provided `BashOperations`
- extension-provided complete results
- deferred results flushed after an active agent turn

It is observational: execution-routing extensions still own execution.

## Current event-driven flow

```text
user_bash_result
        │
        ├── excludeFromContext? ── yes ──► stop
        │
        ├── cancelled? ─────────── yes ──► stop
        │
        ▼
create empty hidden custom message
        │
        ▼
deliverAs: followUp
triggerTurn: true
        │
        ▼
next agent turn
```

There is no command tracker, session-entry cursor, timer, or lifecycle cleanup.

A nonzero exit still triggers a turn because the failure output can be useful model context. `!!` and cancelled results do not trigger a provider request.

## Why an empty message remains

The event removes polling, but Pi still does not expose a bare "run the agent again with existing context" method. `pi.sendMessage()` requires a message to trigger a turn.

Bang Don't Ghost sends:

```typescript
{
  customType: "bang-dont-ghost",
  content: [],
  display: false,
}
```

with:

```typescript
{
  triggerTurn: true,
  deliverAs: "followUp",
}
```

Pi already placed the command and output in the preceding `bashExecution` context. The empty hidden message only starts or queues the next turn; it does not duplicate either value.

## Temporary local typing

The installed runtime patch emits `user_bash_result`, but the published TypeScript declarations for Pi 0.84.2–0.84.3 do not include it. The extension defines the payload locally and isolates one cast around `pi.on`.

```text
runtime event exists
        │
        ├── published ExtensionAPI types do not know it
        │
        ▼
local typed registration adapter
```

When Pi publishes the event type and `ExtensionAPI.on` overload, the local event interface and adapter cast can be deleted without changing runtime behavior.

## Runtime requirement

Stock Pi 0.84.2–0.84.3 never emits `user_bash_result`. On an unpatched runtime, this branch loads but receives no completion event and therefore starts no follow-up. It deliberately has no polling fallback: restoring one would also restore the complexity and limitations this refactor removes.

The source checkout provides `scripts/patch-pi-user-bash-result.mjs`. The locally installed `pi-patch-user-bash-result` command invokes that script to verify or reapply the patch after Pi updates. It is idempotent, uses exact source anchors, syntax-checks a temporary candidate before atomic replacement, and fails with terminal and macOS notifications rather than partially modifying an unknown Pi build.

The command is manual. It does not run during Pi startup, and neither the patcher nor its global command shim is part of the published npm package.
