# Why the runtime patch exists

Historical context: https://github.com/earendil-works/pi/issues/8530

The original implementation polled session entries on pi 0.84.x. This extension now intentionally uses a version-locked **pi 1.2.0 runtime patch**, not polling. See [the README](./README.md) for applying, checking, and restoring it.

## The public API gap

Stock pi 1.2.0 has a pre-execution `user_bash` event, but no extension notification after a `bashExecution` result is recorded and finalized into model context:

```text
user_bash → selected execution backend → recorded bashExecution → finalized context
                                                                    │
                                                   user_bash_result ← added by patch
```

The patch covers both immediate recording and deferred results flushed after an active agent run. The bundled TUI and RPC paths share those recording methods.

## Why not intercept execution?

Returning custom operations or a replacement result from `user_bash` takes ownership of execution. It can bypass later SSH, sandbox, or container handlers. A replacement backend must also preserve shell configuration, command prefixes, streaming, cancellation, truncation, and process-tree handling.

The post-recording event leaves all of those responsibilities with pi and the user's selected backend.

## Why not poll?

Polling can work on an unmodified host, but adds lifecycle work and observation overhead. The original design also correlated commands by text and could leave a tracker waiting forever if a backend threw without recording a result. That design was deliberately retired.

Maintaining a version-locked runtime patch was explicitly selected for the 1.2.0 migration. It is not a claim that stock pi supports the event.

## Event and typing contract

`UserBashResultEvent` in `index.ts` describes the patched payload. A module augmentation adds the corresponding typed `ExtensionAPI.on` overload without casting the API. The runtime patch must still be installed: declarations alone do not create runtime events.

The patcher:

- accepts exactly pi 1.2.0's bundled CLI layout;
- requires both source anchors to match exactly once;
- accepts an existing patch only if both complete replacement sections match;
- syntax-checks a temporary candidate before atomic replacement;
- retains an original backup and refuses unsafe restoration;
- provides read-only `--check` and guarded `--restore` commands.

Tests exercise the actual installed 1.2.0 bundle's recording methods and assert that events observe finalized context, including deferred batches. Cancellation and double-bang exclusions are handled by the extension, not by changing pi's execution behavior.

## Why an empty message remains

The recorded `bashExecution` already contains the command and result. To request another agent turn, the extension submits an empty, hidden custom message with `triggerTurn: true` and `deliverAs: "followUp"`. It does not duplicate shell output in context.

Successful and nonzero results trigger a turn. Cancelled commands and `!!` do not. Eligible completions can incur model-provider usage.

## Operational boundary

The patcher is source-only and never runs at startup. Reapply it manually after reinstalling 1.2.0, then **restart pi**. `/reload` cannot replace already-loaded core runtime code. A different pi release needs a separately verified patcher update. The extension has no polling fallback.
