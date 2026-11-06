# Pi Extension Utilities

Shared contracts for independently loaded Pi extensions. Package staging vendors this library into consumers; the status-line symbol remains compatible with older installed extensions.

<!-- package-tools:install:start -->

## Installation

Install the library in a Pi extension package:

```bash
npm install @stagefright5/pi-extension-utils
```

<!-- package-tools:install:end -->

`setThemedStatus(ui, id, theme => theme.fg("warning", "Planning"))` publishes a plain status fallback plus a renderer for the shared status bar. The renderer runs again after theme invalidation, so stored status text never retains old ANSI colors. Other footers display the plain text using their current foreground. Clear it with `setThemedStatus(ui, id, undefined)` on shutdown. Keep renderers synchronous and side-effect-free; publish again when status data changes.

Private JSON files use exclusive temporary files and atomic replacement. They are separate from Pi's settings file, so extension commands cannot overwrite Pi's settings. Read effective legacy defaults with `pi.getSettings()` and the `getSetting` helper in `settings.ts`; extension-owned files hold saved command overrides.

`SIDE_AGENT_FORK_TYPE` and `isSideAgentForkEntry` describe the custom session entry a side-agent fork appends after its copied branch. Extensions that keep writable state outside the transcript can treat state recorded before the latest marker as inherited from another session.

`notifyIfActive` guards delayed notifications against aborted lifetimes and revoked context getters. `createUsageTracker` tracks UI-owned model work and records reported usage independently of UI cancellation. Abort requests before calling `drain()` at session shutdown: it waits up to one second, then closes the recorder so late completions cannot affect a replacement session. This is best-effort accounting for provider-reported usage, not a billing ledger.
