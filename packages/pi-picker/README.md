# Pi Picker

Most of this library was written with the pi agent CLI.

Fast multi-word fuzzy search, highlighted lists, and picker overlays for pi extensions. Prompt History Search, Tool Output Browser, and Prompt Truly Mine use it for `Alt+R`, `/tool-output`, and composer autocomplete.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the library in a Pi extension package:

```bash
npm install @stagefright5/pi-picker
```

<!-- package-tools:install:end -->

Extensions in this workspace do not depend on the published package at runtime: staging copies the library into each extension's `vendor/pi-picker/` and rewrites its imports.

## Search

- Every query word must match; order does not matter.
- A word scores highest as a substring at a word start (start of text, or after a space, `/`, `-`, `_`, `.`, or `:`), then as a later substring, then as a fuzzy subsequence that rewards consecutive letters and word starts. Any substring match outranks any fuzzy match.
- A multi-word query that also appears as one phrase gets a bonus. An optional per-item boost (for example recency) breaks near-ties.
- Case and accents are ignored (`é` matches `e`); highlight ranges map back to the original characters.

```ts
import { SearchIndex, Searcher } from "@stagefright5/pi-picker";

const index = new SearchIndex((prompt: Prompt) => prompt.text, prompts);
const searcher = new Searcher(index, { limit: 200, boost: (id) => recency(index.items[id]!) });
const { ids, total } = searcher.search("auth tests");
```

`Searcher` reuses results when a query extends its last word or adds a word. It rescores only the previous matches, and only for the changed word. Fuzzy scans resume where the shorter word stopped. Items that cannot reach the top results skip exact fuzzy scoring. `searchAsync` yields between slices on very large indexes and drops superseded searches. `FilterState` turns declared filter groups (options OR within a group, AND across groups, optionally exclusive) into a cached item mask.

## Picker

`createPicker` returns a `Component` for `ctx.ui.custom`: title and live count, search input, filter chips, a ranked list with highlighted matches, a preview pane (side by side from 100 columns, stacked below on narrower terminals), and a footer with actions.

| Key                            | Action                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| typing                         | Search                                                      |
| `Up` / `Down`, `PgUp` / `PgDn` | Move the selection (your `tui.select.*` keybindings)        |
| `Shift+Up` / `Shift+Down`      | Scroll the preview                                          |
| `Enter`, double-click          | Primary action                                              |
| `Tab`                          | Mark or unmark the selected item (multi-select)             |
| `Ctrl+F`, then a number        | Toggle a filter chip                                        |
| action keys (e.g. `Ctrl+Y`)    | Run on marked items, or the selected item                   |
| `Esc`                          | Cancel a pending confirmation, then clear marks, then close |

The panel is 80% of the terminal by default. Pass `height: { max, min, fit }` to change it: `max` is a fraction of the terminal rows (or rows when above 1), and `fit: true` shrinks the panel to its items (one row each, plus title, input, filters, and footer) down to `min` rows; typing never resizes it. A function returning rows still works.

Preview lines are wrapped once per item, query, and width. For live content such as a log, pass `previewKey(item)` returning a version that changes with the text, so only a changed preview is re-wrapped; `previewTail: true` opens the preview at its end and keeps following new lines until you scroll up.

Space types a space, so multi-word queries work; marking uses `Tab`. Actions can require a second press (`confirm`), notify in the footer, remove items, or close the picker. The preview opens at the first match.

`renderInlinePanel` draws a suggestion panel for a host-owned list (Prompt Truly Mine passes Pi's native autocomplete state): aligned names, highlighted query, visible selection, word-boundary `…`, and a position/keys row.

## Performance

`pnpm bench:picker` generates long prompt-like items from a small vocabulary (a stress case: most items fuzzy-match early letters), types eight queries one keystroke at a time, and fails when a p95 exceeds its budget. Results on an Apple-silicon Mac:

| Benchmark                                      | p50 ms | p95 ms | Budget |
| ---------------------------------------------- | -----: | -----: | -----: |
| Keystroke, 1k items                            |   0.15 |   0.27 |    ≤ 1 |
| Keystroke, 10k items                           |   0.59 |   1.21 |  ≤ 1.5 |
| Keystroke, 100k items                          |   3.82 |   8.57 |   ≤ 10 |
| Open, 10k items (index + first list)           |  12.38 |  20.65 |   ≤ 30 |
| Frame (160×48 picker with preview, 10k items)  |   0.55 |   0.64 |    ≤ 2 |
| Frame, live 300-line tail re-wrapped per frame |   0.70 |   0.75 |    ≤ 2 |

## Compatibility

Developed against pi/pi-tui 1.3.0. Pure TypeScript source, loaded by Pi's `jiti` like the extensions.
