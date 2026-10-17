# @stagefright5/pi-extension-utils

## 0.1.0

### Minor Changes

- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

### Patch Changes

- 8b0bcc5: Preserve bash output and truncation notices on timeout through the host adapter protocol. Restore accent-colored model statuses and legacy fast-status placement. Guard delayed notifications against retired contexts, retain reported summary usage during cancellation and bounded shutdown draining, keep legacy plan restoration read-only until new activity, silently skip unconfigured summaries without a current model, and avoid indexing repeated tool payloads. Narrow status shims and separate settings helpers from storage.
