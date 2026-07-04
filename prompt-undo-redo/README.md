# Prompt Undo/Redo

Adds familiar undo and redo shortcuts to pi's prompt input box by replacing the editor with a `CustomEditor` subclass using the current pi editor-component API.

## Shortcuts

- `Ctrl+Z` — undo the last prompt edit
- configured `tui.editor.undo` key (default `Ctrl+-`) — undo
- `Ctrl+Shift+Z` — redo
- `Ctrl+Y` — redo

Undo history is coalesced for normal typing runs, restores the prompt cursor position, and is cleared after submitting a prompt so sent messages are not restored accidentally.

## Notes

- The editor delegates to pi's `CustomEditor`, so app-level shortcuts, autocomplete, prompt history, paste handling, and image paste continue to work.
- The extension captures and restores any previously configured editor factory during session shutdown, so it is less likely to clobber another editor extension.
- Cursor-restoring undo/redo currently requires a small compatibility shim around pi-tui editor internals because pi-tui exposes `getCursor()` but no public `setCursor()`/snapshot-restore API. If pi-tui changes those internals, the extension falls back to public text restore behavior.
- `Ctrl+Z` is repurposed for undo while this extension is active, so pi's default suspend shortcut is not reached from the prompt editor.
- `Ctrl+Y` is repurposed for redo while this extension is active; use `Alt+Y` for yank-pop if you use pi's kill ring.

## Installation

Place this directory at:

```text
~/.pi/agent/extensions/prompt-undo-redo/
```

Then run `/reload` or restart pi.
