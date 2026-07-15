# Global Prompt History Search

Adds shell-style reverse search across textual user prompts saved in all pi sessions and projects.

[Back to the extension collection](../README.md)

## Usage

Open the picker in TUI mode:

- `Alt+R` — open search using the current editor draft as the initial query
- `/prompt-history [initial query]` — open search with an optional explicit query

Inside the picker:

- type to filter prompts
- `Alt+R` or `Down` — select an older match
- `Up` — select a newer match
- `Page Up` / `Page Down` — move by one visible page
- `Enter` — restore the selected prompt into the editor
- `Escape` or `Ctrl+C` — cancel and preserve the existing draft

Restoring a prompt does **not** submit it or switch to its source session.

## Search scope

The index includes textual user messages from every session returned by pi's global session listing, including messages retained on alternate branches. Image-only prompts and empty text are skipped.

Results are newest-first and show:

- prompt preview
- date and time
- session name and file ID
- source working directory

Matching is case-insensitive. Every whitespace-separated query token must either be a substring of the searchable prompt metadata or satisfy pi-tui's fuzzy matcher.

## Performance and resilience

pi's global session listing scans saved sessions whenever the picker opens. Parsed prompts are cached in memory by session path and modification time, so unchanged session files are not reparsed during the current pi process. Deleted sessions are removed from the cache.

Unreadable files are skipped. Partially malformed JSONL files contribute any entries pi can parse and produce a warning in the picker instead of aborting the entire search.

Large session collections can make the first search slower. The extension shows an `Indexing prompt history…` footer status while building the index.

## Privacy

The extension reads prompts from unrelated projects and sessions. It keeps the index in process memory and does not intentionally send the index, queries, or selected prompts to a model or remote service. A restored prompt is sent normally only if you later submit it.

Anyone with access to your terminal can use the picker to inspect saved prompts, so treat the search UI as sensitive.

## Requirements and conflicts

- Interactive TUI mode is required; the custom picker is unavailable in RPC, JSON, and print modes.
- `Alt+R` must not be claimed by a later-loaded shortcut extension.

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/prompt-history-search/
```

Run `/reload` or restart pi after installation.
