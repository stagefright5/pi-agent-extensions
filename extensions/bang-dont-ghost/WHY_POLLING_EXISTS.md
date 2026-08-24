# Why Polling Exists AKA https://github.com/earendil-works/pi/issues/8530

Bang Don't Ghost starts an agent follow-up after Pi finishes a user-entered single-`!` shell command. The extension polls session entries because Pi 0.84.2 exposes a pre-execution `user_bash` hook, but no post-execution event for the recorded result.

## The missing lifecycle event

Pi's extension lifecycle currently provides this interception point:

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

`user_bash` fires before execution. It exposes the command, working directory, and whether `!!` was used. A handler may return custom `BashOperations` or a complete replacement result.

What Bang Don't Ghost needs is a notification after the final step:

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
user_bash_result event       ← not currently exposed
```

The timing matters. Pi must record the `bashExecution` message before the extension starts another agent turn so that the command and output are already present in model context.

## Why the extension does not intercept execution

Bang Don't Ghost could return its own operations from `user_bash`, but that would make it an execution backend rather than an observer.

```text
                         ┌── local shell
user_bash interception ──┼── SSH extension
                         ├── sandbox extension
                         └── container extension
```

Pi uses the first `user_bash` handler that returns a result. If Bang Don't Ghost returned operations, it could prevent an SSH, sandbox, container, or other shell-routing extension from handling the command. Reimplementing execution would also risk drifting from Pi's configured shell, command prefix, cancellation, timeout, streaming, and process-tree behavior.

Instead, Bang Don't Ghost returns nothing from `user_bash`:

```text
Bang Don't Ghost observes command start
                │
                ├── returns undefined
                │
                ▼
Pi or another extension chooses execution backend
                │
                ▼
Pi records the common bashExecution message
                │
                ▼
Bang Don't Ghost observes the recorded result
```

This keeps execution ownership with Pi and composes with custom backends.

## End-to-end flow

### Command entered while Pi is idle

```text
User                 Pi                  Extension              Provider
 │                    │                      │                      │
 │ !npm test          │                      │                      │
 ├───────────────────►│                      │                      │
 │                    │ user_bash            │                      │
 │                    ├─────────────────────►│                      │
 │                    │                      │ remember "npm test" │
 │                    │◄─────────────────────┤ return undefined     │
 │                    │                      │                      │
 │                    │ execute command      │ poll every 50 ms     │
 │                    │───────────────┐      │                      │
 │                    │               │      │                      │
 │                    │◄──────────────┘      │                      │
 │                    │ record bashExecution │                      │
 │                    │                      │                      │
 │                    │                      │ sees recorded result │
 │                    │◄─────────────────────┤ empty hidden message │
 │                    │                      │ triggerTurn: true    │
 │                    ├────────────────────────────────────────────►│
 │                    │       context already contains command     │
 │                    │       and output                            │
```

### Command entered while an agent turn is active

Pi defers a shell result when necessary to preserve assistant tool-call and tool-result ordering.

```text
active agent turn ─────────────────────────────── agent_end
       │                                              │
       ├── user runs !command                         │
       ├── command completes                          │
       └── result waits in Pi's pending messages ─────┘
                                                      │
                                                      ▼
                                           bashExecution recorded
                                                      │
                                                      ▼
                                             tracker detects it
                                                      │
                                                      ▼
                                      empty message delivered as followUp
                                                      │
                                                      ▼
                                          next agent turn starts
```

Using `deliverAs: "followUp"` avoids steering or interrupting the active turn. If Pi is already idle when the message is sent, `triggerTurn: true` starts the turn immediately.

## Tracker design

`BashCompletionTracker` stores:

```text
┌────────────────────────────────────────────────┐
│ nextEntryIndex                                 │
│   Index of the first session entry not scanned │
├────────────────────────────────────────────────┤
│ pendingCommands                                │
│   FIFO-like array of command strings awaiting  │
│   a matching bashExecution entry               │
└────────────────────────────────────────────────┘
```

At session start, existing history is marked as already scanned:

```text
entries:          [E0] [E1] [E2] [E3]
nextEntryIndex:                         4
pendingCommands:  []
```

After `!echo hello` fires `user_bash`:

```text
entries:          [E0] [E1] [E2] [E3]
nextEntryIndex:                         4
pendingCommands:  ["echo hello"]
```

After Pi records the result:

```text
entries:          [E0] [E1] [E2] [E3] [E4: bashExecution]
nextEntryIndex:                         4
pendingCommands:  ["echo hello"]
                                             │
                                             ▼ scan
nextEntryIndex:                              5
pendingCommands:  []
completion:       { command: "echo hello", entryId: "E4" }
```

The scan algorithm is equivalent to:

```text
for each entry after nextEntryIndex:
    ignore non-message entries
    ignore messages whose role is not bashExecution
    ignore entries excluded by !!

    find the first pending command with exactly matching text
    if none exists:
        continue

    remove one matching pending command
    if the result was cancelled:
        continue

    return a completion

advance nextEntryIndex to the current entry count
```

An array is used for pending commands so repeated commands remain distinct:

```text
pendingCommands = ["pwd", "pwd"]

first recorded pwd  → removes one pending item
second recorded pwd → removes the other pending item
```

## Poll lifecycle

Only one timer is active per extension instance.

```text
session_start
     │
     ├── mark extension active
     ├── cancel any old timer
     └── reset tracker at current history length

single-! user_bash
     │
     ├── remember command
     └── schedule immediate scan
               │
               ▼
             scan
               │
               ├── pending remains → scan again in 50 ms
               └── no pending      → stop timer

session_shutdown
     │
     ├── mark extension inactive
     └── cancel timer
```

The initial `setTimeout(..., 0)` allows Pi to continue into command execution without blocking the `user_bash` handler. Subsequent scans use a 50 ms interval. The tracker advances a cursor, so it only examines session entries added since the previous scan.

## Result policy

```text
Recorded result                    Automatic follow-up
──────────────────────────────────────────────────────
single !, exit code 0              yes
single !, nonzero exit code        yes
single !, user cancelled           no
double !!                          no
LLM bash tool call                 no
```

A nonzero exit is still useful model context: the next turn can explain or act on the failure. A cancellation consumes the pending command without starting a provider request.

Double-`!!` commands are excluded twice:

1. The `user_bash` handler does not track events with `excludeFromContext: true`.
2. The tracker ignores recorded `bashExecution` entries with that flag.

## Why an empty hidden message is sent

Pi's public extension API does not expose a bare "run the agent again using current context" operation. `pi.sendMessage()` can trigger a turn, but it requires a message.

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

The effective ordering is:

```text
bashExecution
  command: echo hello
  output:  hello

hidden custom message
  content: []

provider request
```

The extension does not duplicate the command or output. Pi already converts the preceding `bashExecution` entry into model context containing both.

## Alternatives considered

### Wrap local `BashOperations`

This would reveal completion directly, but it would claim the `user_bash` interception slot and could prevent another extension from routing execution. It would also need to preserve Pi's exact local shell configuration.

### Return a complete replacement result

The extension would have to execute every command itself and reproduce output streaming, cancellation, timeout, truncation, shell selection, and remote-backend behavior.

### Call the model provider directly

A direct provider call would bypass Pi's agent loop, tool execution, retries, compaction, lifecycle events, queue handling, session persistence, and normal rendering.

### Use `before_agent_start` or `context`

These hooks can modify an agent turn that is already starting. They cannot start a new turn after an otherwise passive `!` command.

### Add a fixed command timeout

A timeout would stop polling leaks, but it would incorrectly abandon legitimate long-running commands. The extension does not silently impose an execution-duration policy.

## Limitations of polling

### No recorded result

If a shell backend throws before Pi records a `bashExecution` entry, the pending command cannot be resolved. Polling continues until the session shuts down.

```text
pending command
      │
      ▼
backend throws before recording
      │
      └── no completion signal exists
                    │
                    ▼
          poll remains active
```

### Correlation uses command text

`user_bash` does not provide an execution ID that later appears on the session result, so correlation uses exact command text. Repeated successfully recorded commands are handled one at a time. If an execution never records and the identical command is run again, the later result can satisfy the older pending item and leave another pending item unresolved.

### Polling overhead

While at least one command is pending, the extension calls `sessionManager.getEntries()` every 50 ms. The tracker only processes the newly added suffix, but retrieving the session entry list still has a cost.

### Empty-message provider behavior

The trigger message has empty content. Providers that reject or inconsistently serialize an empty final message may not support this approach.

## Removal path

A post-execution event emitted after the result is recorded would remove the timer and tracker entirely. The required extension could be approximately:

```typescript
pi.on("user_bash_result", (event) => {
  if (event.excludeFromContext || event.result.cancelled) return;

  const { message, options } = createEmptyFollowUpRequest();
  pi.sendMessage(message, options);
});
```

For this to replace polling safely, the event should:

- fire after `bashExecution` is available in session and model context
- cover both TUI and RPC user-bash paths
- cover Pi's local backend and extension-provided operations/results
- include command, `excludeFromContext`, and final `BashResult`
- be observational so it composes with execution-routing extensions

Until Pi exposes that completion point, polling the common recorded session message is the least invasive way to observe every backend without taking ownership of shell execution.

## Source map

```text
index.ts
  user_bash/session lifecycle handlers
  50 ms poll scheduling
  hidden follow-up dispatch

bang-follow-up.ts
  pending command tracker
  session-entry cursor
  result matching and cancellation policy

bang-follow-up.test.ts
  result policy
  repeated-command matching
  hidden follow-up shape
  single-! and double-!! integration behavior
```
