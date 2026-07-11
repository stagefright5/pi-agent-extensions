# Global Prompt History Search

Adds shell-style reverse search for user prompts saved across all Pi sessions and projects.

## Usage

- Press `Alt+R` from the normal prompt editor.
- Or run `/prompt-history [initial query]`.
- Type to filter prompts.
- Press `Alt+R` or `Down` to select an older match.
- Press `Up` to select a newer match.
- Press `Page Up` / `Page Down` to move by a page.
- Press `Enter` to copy the selected prompt into the current editor.
- Press `Escape` or `Ctrl+C` to cancel and preserve the existing draft.

Selecting a prompt does **not** submit it and does not switch to its source session.

## Search scope

The index includes textual user messages from every session returned by Pi's global session listing, including messages retained on alternate branches. Image-only prompts are skipped. Results are newest-first and include date, session name or ID, and working-directory context.

Search is case-insensitive and supports fuzzy token matching. When opened with `Alt+R`, the current editor draft seeds the search query. `/prompt-history some text` uses `some text` as the initial query.

Session prompts can contain sensitive information from unrelated projects. The extension reads and searches them locally only; it does not send the index to a model or remote service.

## Performance and resilience

Pi's global session listing scans the saved sessions on each invocation. Extracted prompt records are cached in memory by session path and modification time, so the extension only reparses changed session contents. Deleted sessions are removed from the cache.

Unreadable files are skipped. Partially malformed JSONL files contribute any readable prompts and produce a warning in the picker instead of aborting the entire search.

## Installation

Place this directory at:

```text
~/.pi/agent/extensions/prompt-history-search/
```

Then run `/reload` or restart Pi.
