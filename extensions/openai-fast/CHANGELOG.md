# @stagefright5/pi-openai-fast

## 0.1.3

### Patch Changes

- 8b0bcc5: Audit fixes for pi 1.3.0: keep prompt-history I/O off submission with cross-process locking; reconstruct plan state from branch messages/results and activate its tool only in plan mode; store extension preferences separately from Pi settings; protect and clean background logs; rotate physical-model logs without blocking requests; account for UI summary costs in the status bar; share status contracts; expose structured/nested tool results; and use erasable TypeScript with centralized host version pins.

  Existing plan snapshots and recorded directories remain readable. Composer shortcuts and dollar-reference behavior, and all-tool explanations by default, are retained intentionally. Summary costs use durable custom usage entries; Pi's native session total cannot include UI-only calls through the public 1.3.0 API.

## 0.1.2

### Patch changes

- Display OpenAI Fast mode as the text-style ⚡︎ glyph immediately after effort in the compact footer, without duplicating the generic extension status. Keep it attached to effort in shortened model labels and remove it when Fast mode is off.

## 0.1.1

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.
