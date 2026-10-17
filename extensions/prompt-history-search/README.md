# Global Prompt History Search

Most of this extension was written with the pi agent CLI.

Adds shell-style reverse search across saved user prompts in a local index.

[Back to the extension workspace](../../README.md)

## Usage

Open the picker in TUI mode:

- Press `Alt+R` to search using the current editor draft as the initial query.
- Run `/prompt-history [initial query]` to search with an optional query.

Inside the picker (built on the shared [Pi Picker](../../packages/pi-picker/README.md)):

- Type to search; multi-word queries match words in any order, and matches are highlighted in the list and preview.
- Press `Alt+R` or `Down` to select the next match, `Up` for the previous one, and `Page Up` / `Page Down` to move by a page.
- The preview pane shows the full selected prompt with its date, session, and directory, opened at the first match (beside the list from 100 columns, below it on narrower terminals). Scroll it with `Shift+Up` / `Shift+Down`.
- Press `Tab` to mark prompts; actions then apply to every marked prompt.
- Press `Enter` (or double-click) to insert the selected or marked prompts into the editor; several prompts are joined by blank lines.
- Press `Ctrl+Y` to copy, and `Ctrl+D` twice to delete from history.
- Press `Ctrl+F` then a number to toggle filters: this project or this session; last 24 hours or 7 days; prompts or commands.
- Press `Escape` to cancel a pending delete, then clear marks, then close and preserve the existing draft.

Restoring a prompt does not submit it or switch to its source session.

## Search scope

The index contains text from user prompts sent in the last 30 days. The extension adds new prompts as you send them.

With [Prompt Truly Mine](../prompt-truly-mine/README.md) also loaded, the index includes submitted slash commands: built-in and extension commands, including their arguments. Prompts with `$skill` or `$template` references are ordinary prompts and are indexed as typed. That editor reports submissions before command dispatch, since commands can bypass Pi's normal input event. Merely selecting a completion is not recorded. Selecting a command from history restores it into the draft without executing it. Pending writes are drained before opening search and during orderly shutdown/reload.

On every TUI session start, including fresh launches and `/reload`, the extension also offers the newest 100 unique saved prompts (all projects) through the `prompt-history-search:recent` event. Prompt Truly Mine uses them for Up/Down recall. This reads only the saved index and does not scan session files.

Without Prompt Truly Mine, live capture still skips slash-style inputs; normal session backfill remains available. Commands that were never recorded in an index or session cannot be recovered retroactively.

The first time you press `Alt+R`, the extension reads the last 30 days of prompts from local pi session JSONL files and saves the index, unless it has already done so. Later searches load the saved index and refresh the current session directory, rather than scanning every project again. This also discovers sessions under a custom `--session-dir` after the initial backfill.

The extension skips image-only prompts and empty text. An empty query shows the newest prompts first. Each row shows the prompt (cut around the first match) with its date and directory.

Matching ignores case and accents and applies only to the user prompt text. Every query word must match, as a substring or as a fuzzy subsequence. Ranking favors matches at the start of a word, then other substrings, then fuzzy matches; a multi-word query that appears as one phrase ranks higher; more recent prompts win near-ties. Compared with earlier versions the same prompts match, but recency now outweighs how far into the prompt a match appears.

Deleting prompts records a small tombstone (key and timestamp) in the index's optional `deleted` list, so rescanning session files cannot restore them; tombstones expire with the 30-day retention. The index version is unchanged, and older versions of the extension ignore the list.

## Persistence, retention, and performance

The index is stored locally at:

```text
~/.pi/agent/prompt-history-search/index.json
```

This default path is resolved with pi's `getAgentDir()`. Setting `PI_CODING_AGENT_DIR` isolates the index and normal session discovery to that profile; it does not read the default profile. The active session manager supplies custom session-directory paths.

The extension removes entries older than 30 days whenever it loads or updates the index.

After the initial scan, `Alt+R` reads the saved JSON index and checks the current session directory through pi's discovery API. The scanner limits how many local session files it reads at once. It caches parsed sessions in memory by path and modification time for the current pi process.

The scanner skips unreadable files. If a JSONL file is partially malformed, it keeps the entries pi can parse and shows a warning in the picker instead of aborting the search.

## Privacy

The extension reads prompts from unrelated projects and sessions during the one-time bootstrap. It keeps the index locally and does not intentionally send the index, queries, or selected prompts to a model or remote service. A restored prompt is sent normally only if you later submit it.

Anyone with access to your terminal or local index file can inspect saved prompts and command arguments, so treat the search UI and persisted index as sensitive. Slash-command arguments are not redacted; avoid entering secrets in commands you do not want retained.

## Requirements and conflicts

- Interactive TUI mode is required; the custom picker is unavailable in RPC, JSON, and print modes.
- `Alt+R` must not be claimed by a later-loaded shortcut extension.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-prompt-history-search
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/prompt-history-search` or expose it through the workspace's development symlink. Run `/reload` after source changes.
