# Global Prompt History Search

Most of this extension was written with the pi agent CLI.

Adds shell-style reverse search across saved user prompts in a local index.

[Back to the extension workspace](../../README.md)

## Usage

Open the picker in TUI mode:

- Press `Alt+R` to search using the current editor draft as the initial query.
- Run `/prompt-history [initial query]` to search with an optional query.

Inside the picker:

- Type to filter prompts. The picker highlights matching text in each preview.
- Press `Alt+R` or `Down` to select the next match.
- Press `Up` to select the previous match.
- Press `Page Up` / `Page Down` to move by one visible page.
- Press `Right Arrow` to expand the full selected prompt.
- Press `Left Arrow` to collapse the expanded prompt.
- Press `Enter` to restore the selected prompt into the editor.
- Press `Escape` or `Ctrl+C` to cancel and preserve the existing draft.

Restoring a prompt does not submit it or switch to its source session.

## Search scope

The index contains text from user prompts sent in the last 30 days. The extension adds new prompts as you send them. It skips slash-style inputs so it does not index extension commands or built-in commands as prompts.

The first time you press `Alt+R`, the extension reads the last 30 days of prompts from local pi session JSONL files and saves the index, unless it has already done so. Later searches load the saved index instead of scanning all sessions.

The extension skips image-only prompts and empty text. Search results appear best-match-first, with newer prompts first when matches rank equally. An empty query shows the newest prompts first. Results show:

- prompt preview
- date and time
- session name and file ID
- source working directory

Matching is case-insensitive and applies only to the user prompt text. Every whitespace-separated query token must either be a substring of the prompt text or satisfy pi-tui's fuzzy matcher. Ranking favors exact phrase matches, then substring token matches, then fuzzy token matches. Each preview shows the text around the first match.

## Persistence, retention, and performance

The index is stored locally at:

```text
~/.pi/agent/prompt-history-search/index.json
```

The extension removes entries older than 30 days whenever it loads or updates the index.

After the initial scan, `Alt+R` reads only the saved JSON index. The scanner limits how many local session files it reads at once. It caches parsed sessions in memory by path and modification time for the current pi process.

The scanner skips unreadable files. If a JSONL file is partially malformed, it keeps the entries pi can parse and shows a warning in the picker instead of aborting the search.

## Privacy

The extension reads prompts from unrelated projects and sessions during the one-time bootstrap. It keeps the index locally and does not intentionally send the index, queries, or selected prompts to a model or remote service. A restored prompt is sent normally only if you later submit it.

Anyone with access to your terminal or local index file can inspect saved prompts, so treat the search UI and persisted index as sensitive.

## Requirements and conflicts

- Interactive TUI mode is required; the custom picker is unavailable in RPC, JSON, and print modes.
- `Alt+R` must not be claimed by a later-loaded shortcut extension.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-prompt-history-search
```

For source development, load this directory with `pi -e ./extensions/prompt-history-search` or expose it through the workspace's development symlink. Run `/reload` after source changes.
