# @stagefright5/pi-dialog

## 0.1.1

### Patch Changes

- 426fdf0: Use semantic theme backgrounds in shared picker, popup, and composer surfaces instead of deriving dark-only colors. Keep job, plan, and side-agent statuses uncolored in Pi's persistent storage and apply the active theme when the shared footer renders, with plain fallbacks for other footers. Include the updated vendored UI libraries in consuming extensions.

## 0.1.0

### Minor Changes

- e6f91bf: Add `@stagefright5/pi-dialog`: a framed `Popup` for any component (rounded border in a tone colour with the title and meta set into it, tinted panel, footer action chips, drop shadow, tiered degradation on small terminals) and ready-made dialogs built on it: `confirm`, `alert`, `select`, `input`, `editor`, `showDocument` (scrollable markdown/diff with actions, copy, and drag selection), and `withLoader`. Dialogs accept `signal` and `timeout` and fall back to Pi's built-in dialogs outside TUI mode.
