# @stagefright5/pi-extension-utils

## 0.2.0

### Minor Changes

- 8de87bf: Add the side-agent fork provenance contract (`SIDE_AGENT_FORK_TYPE`, `SideAgentForkData`, `isSideAgentForkEntry`) so extensions can recognise state inherited from another session.

### Patch Changes

- 426fdf0: Use semantic theme backgrounds in shared picker, popup, and composer surfaces instead of deriving dark-only colors. Keep job, plan, and side-agent statuses uncolored in Pi's persistent storage and apply the active theme when the shared footer renders, with plain fallbacks for other footers. Include the updated vendored UI libraries in consuming extensions.

## 0.1.0

### Added

- Provide shared status-line, model-status, and clickable-action contracts for independently loaded extensions, retaining the legacy status-line symbol.
- Add private JSON storage with exclusive temporary files and atomic replacement. Keep extension overrides separate from Pi settings while supporting effective legacy defaults.
- Guard delayed notifications against aborted lifetimes and revoked session contexts.
- Track provider-reported usage for UI-owned model calls independently of UI cancellation. Bound shutdown draining to one second and reject late recording into a replacement session.
- Bundle the library privately into consuming extensions during package staging.

### Notes

- Usage tracking is best-effort accounting, not a billing ledger. Callers must abort requests before draining on shutdown.
