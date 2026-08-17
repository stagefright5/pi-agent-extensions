# Global Prompt History Search

Adds shell-style reverse search across textual user prompts from a local persisted prompt index.

[Back to the extension collection](../README.md)

## Usage

Open the picker in TUI mode:

- `Alt+R` — open search using the current editor draft as the initial query
- `/prompt-history [initial query]` — open search with an optional explicit query

Inside the picker:

- type to filter prompts
- matching text is highlighted in each prompt preview
- `Alt+R` or `Down` — select the next match
- `Up` — select the previous match
- `Page Up` / `Page Down` — move by one visible page
- `Right Arrow` — expand the full selected prompt
- `Left Arrow` — collapse the expanded prompt
- `Enter` — restore the selected prompt into the editor
- `Escape` or `Ctrl+C` — cancel and preserve the existing draft

Restoring a prompt does **not** submit it or switch to its source session.

## Search scope

The persisted index contains textual user prompts from the last 30 days. New prompts are added as the user sends them. Slash-style inputs are skipped so extension commands and built-in commands are not indexed as prompts.

On first `Alt+R`, if the index has not yet been bootstrapped from saved sessions, the extension performs a one-time 30-day backfill from local pi session JSONL files and persists the result. Later searches load the persisted index directly instead of scanning all sessions.

Image-only prompts and empty text are skipped. With an active query, results are ranked by best match first, with newer prompts used as the tie-breaker. With an empty query, results remain newest-first. Results show:

- prompt preview
- date and time
- session name and file ID
- source working directory

Matching is case-insensitive and applies only to the user prompt text. Every whitespace-separated query token must either be a substring of the prompt text or satisfy pi-tui's fuzzy matcher. Ranking favors exact phrase matches, then substring token matches, then fuzzy token matches. Prompt previews are excerpted around the first match so highlighted matching text is visible instead of being hidden behind ellipses.

## Persistence, retention, and performance

The index is stored locally at:

```text
~/.pi/agent/prompt-history-search/index.json
```

Entries older than 30 days are purged whenever the index is loaded or updated.

The normal search path only reads the persisted JSON index, so `Alt+R` should be fast after the one-time bootstrap. The bootstrap scanner reads local session files directly with limited concurrency and caches parsed sessions in memory by path and modification time for the current pi process.

Unreadable files are skipped. Partially malformed JSONL files contribute any entries pi can parse and produce a warning in the picker instead of aborting the entire search.

## Privacy

The extension reads prompts from unrelated projects and sessions during the one-time bootstrap. It keeps the index locally and does not intentionally send the index, queries, or selected prompts to a model or remote service. A restored prompt is sent normally only if you later submit it.

Anyone with access to your terminal or local index file can inspect saved prompts, so treat the search UI and persisted index as sensitive.

## Requirements and conflicts

- Interactive TUI mode is required; the custom picker is unavailable in RPC, JSON, and print modes.
- `Alt+R` must not be claimed by a later-loaded shortcut extension.

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/prompt-history-search/
```

Run `/reload` or restart pi after installation.
