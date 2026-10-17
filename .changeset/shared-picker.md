---
"@stagefright5/pi-picker": minor
"@stagefright5/pi-prompt-history-search": minor
"@stagefright5/pi-tool-output-browser": minor
"@stagefright5/pi-prompt-truly-mine": minor
---

Add `@stagefright5/pi-picker`: fast multi-word fuzzy search (word-start ranking, accent-insensitive, incremental narrowing, async slices for very large lists), highlighted lists, preview panes, filter chips, multi-select actions, and an inline suggestion panel. Extensions bundle pi-picker 0.1.0 under `vendor/` at stage time instead of depending on it at runtime.

Prompt History Search moves `Alt+R` onto the picker: ranked search with highlights, a preview pane, filters (project/session, 24 hours/7 days, prompts/commands), multi-select insert, copy, and confirmed delete (persisted as tombstones so session rescans cannot restore deleted prompts). Recency now outweighs match position among equally good matches.

Tool Output Browser gains ranked, highlighted search, an output preview, tool and error filters, and multi-select copy; marked results can be stepped through in the detail view.

Prompt Truly Mine re-ranks composer suggestions with the shared engine and highlights the typed text in the suggestion panel.
