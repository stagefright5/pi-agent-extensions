# Pi Dialog

Framed popups and ready-made dialogs for pi extensions. Plan Mode, Background Bash, and Tool Explain open their overlays with it, so every popup in this workspace looks and behaves the same.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the library in a Pi extension package:

```bash
npm install @stagefright5/pi-dialog
```

<!-- package-tools:install:end -->

Extensions in this workspace do not depend on the published package at runtime: staging copies the library (and the [Pi Picker](../pi-picker/README.md) palette it builds on) into each extension's `vendor/` and rewrites the imports.

## The frame

```
╭─ ◆ Plan review  Add dialogs ─────────── iteration 2 · 34% ─╮
│  ~/repo/plans/plan.md                                       │▌
│                                                             │▌
│  body on the panel colour, thumb ┃ at the right             │▌
│                                                             │▌
├─────────────────────────────────────────────────────────────┤▌
│   a approve    r revise                  c copy   esc close │▌
╰─────────────────────────────────────────────────────────────╯▌
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

- A rounded border in the tone colour (`accent`, `info`, `success`, `warning`, `danger`), with an icon, kind, title, and meta set into the top edge. Long headings are cut with `…`; the meta yields first.
- An optional dim subtitle (the home directory becomes `~`), then the body on the same panel colour as Pi Picker, darker than the composer.
- A footer of action chips: the primary (or focused) one is filled; utilities and status messages sit on the right. Secondary chips drop from the end when the row is too narrow; their keys still work.
- A one-cell drop shadow in a shade of the panel colour.
- Small terminals degrade instead of overflowing: below 24 columns or 8 rows the shadow goes, below 12 columns or 5 rows the border, and below 4 rows the footer.

Overlays draw over their own rectangle only: the shadow cells are opaque and the two shadow corners are blank, and the content behind a popup cannot be dimmed through Pi's overlay API.

## Dialogs

Every dialog accepts `signal` and `timeout` (a countdown appears in the border) and falls back to Pi's built-in `ctx.ui.confirm/select/input/editor` outside TUI mode.

```ts
import { alert, confirm, editor, input, select, showDocument, withLoader } from "@stagefright5/pi-dialog";

if (await confirm(ctx, { title: "Delete 3 jobs?", message: "This cannot be undone.", tone: "danger", confirmLabel: "Delete" })) { … }
const branch = await input(ctx, { title: "New branch", placeholder: "feature/…", validate: (v) => (/\s/.test(v) ? "No spaces" : undefined) });
const model = await select(ctx, { title: "Model", options: [{ value: "a", label: "Alpha", description: "fast" }] });
const notes = await editor(ctx, { title: "Revise plan", message: "What should change?" });
const action = await showDocument(ctx, { kind: "Review", title, content: markdown, actions: [{ key: "a", label: "approve", value: "approve", primary: true }] });
const summary = await withLoader(ctx, "Generating summary…", signal, (signal) => summarize(signal));
await alert(ctx, { title: "Saved", message: "All changes are on disk.", tone: "success" });
```

| Dialog         | Keys                                                                                                    | Resolves                               |
| -------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `confirm`      | `y` / `n`, `Tab` / `←` / `→` move the focus, `Enter` presses it, `Esc` / `Ctrl+C` cancel                | `true` / `false` (danger focuses "no") |
| `alert`        | `Enter`, `Esc`, `Ctrl+C`                                                                                | when closed                            |
| `select`       | `↑` / `↓` / `j` / `k`, `PgUp` / `PgDn`, `Home` / `End`, `1`–`9`, click; disabled items are skipped      | the value, or `undefined`              |
| `input`        | Editing keys, `Enter` submits (validation errors show inline), `Esc` cancels                            | the text, or `undefined`               |
| `editor`       | Pi's multi-line editor: `Enter` submits, `Shift+Enter` adds a line, external editor key, `Esc` cancels  | the text, or `undefined`               |
| `showDocument` | Action keys, `c` copy, `↑` / `↓` / `j` / `k`, `PgUp` / `PgDn` / `Space`, `g` / `G`, wheel, drag to copy | the action value, or `"cancel"`        |
| `withLoader`   | `Esc` / `Ctrl+C` abort the work's signal                                                                | the work's result, or `undefined`      |

Selection and confirmation keys follow your `tui.select.*` keybindings.

## Custom popups

`openPopup` frames any component and resolves with the value passed to `close`, or `undefined` on cancel, abort, or timeout. `close` is idempotent; abort and timer listeners are removed exactly once, also when Pi disposes the popup.

```ts
import { openPopup } from "@stagefright5/pi-dialog";

const result = await openPopup<string>(
  ctx,
  (api) => {
    const body = new MyComponent({ onDone: (value) => api.close(value), height: () => api.popup.bodySize().height });
    return { body, options: { meta: () => body.status() } };
  },
  { title: "My tool", icon: "⚙", height: { fit: true, max: 0.5 }, overlay: { width: "90%", minWidth: 50 } },
);
```

- The body gets an exact rectangle. Bodies that know their height implement `renderBody(width, height)` (and `naturalHeight(width)` to fit); other components are rendered at the body width and cut or padded to the body height. `bodySize()` reports the rectangle for components that size themselves, such as an embedded [Pi Picker](../pi-picker/README.md).
- Keys reach the body unless they match a declared action. With `focusActions`, `Tab` / `←` / `→` and `Enter` drive the buttons; without it the popup takes no keys of its own, so a picker keeps `Tab` for marking.
- Mouse events are translated to body-local coordinates; drags captured by the body keep reaching it outside the frame. Footer chips are clickable.
- `focused` is forwarded to the body, so hardware cursors in inputs work.
- `popup.set(option, value)`, dynamic getters for `kind` / `title` / `meta` / `subtitle`, and `popup.setStatus(text, tone)` update the chrome while the popup is open.
- `height` is `{ max, min, fit }` (a fraction of the terminal rows when `max ≤ 1`, otherwise rows; default 80%) or a function returning rows.

`Popup` itself is exported for hosts that manage the overlay directly or for tests: `new Popup(body, options, { rows, theme, requestRender, keybindings })`.

## Development

Run `pi -e packages/pi-dialog/demo/index.ts` and then `/dialog-demo` for a gallery of every variant. The demo is not published.

## Compatibility

Developed against pi/pi-tui 1.3.0. Pure TypeScript source, loaded by Pi's `jiti` like the extensions.
