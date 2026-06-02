# Prompt Undo/Redo

Adds familiar undo and redo shortcuts to pi's prompt input box by replacing the editor with a `CustomEditor` subclass.

## Shortcuts

- `Ctrl+Z` — undo the last prompt edit
- configured `tui.editor.undo` key (default `Ctrl+-`) — undo
- `Ctrl+Shift+Z` — redo
- `Ctrl+Y` — redo

Undo history is coalesced for normal typing runs, supports cursor restoration, and is cleared after submitting a prompt so sent messages are not restored accidentally.

## Notes

- The editor still delegates to pi's `CustomEditor`, so app-level shortcuts, autocomplete, prompt history, paste handling, and image paste continue to work.
- `Ctrl+Z` is repurposed for undo while this extension is active, so pi's default suspend shortcut is not reached from the prompt editor.
- `Ctrl+Y` is repurposed for redo while this extension is active; use `Alt+Y` for yank-pop if you use pi's kill ring.

## Installation

Place this directory at:

```text
~/.pi/agent/extensions/prompt-undo-redo/
```

Then run `/reload` or restart pi.
