# Prompt Undo/Redo

Adds familiar undo and redo behavior to pi's prompt editor by installing a `CustomEditor` subclass in TUI mode.

[Back to the extension collection](../README.md)

## Shortcuts

- `Ctrl+Z` — undo the last prompt edit
- configured `tui.editor.undo` key — undo (`Ctrl+-` by default)
- `Ctrl+Shift+Z` — redo
- `Ctrl+Y` — redo

The editor shows compact undo and redo hints in its bottom border whenever those actions are available.

## Behavior

- Undo history stores both prompt text and cursor position.
- Normal printable typing is coalesced into runs; whitespace, cursor movement, and other edits create useful boundaries.
- A new edit clears the redo stack.
- Programmatic text replacement and text inserted at the cursor are recorded.
- Up to 200 undo and 200 redo snapshots are retained.
- History is cleared after prompt submission so a sent message cannot be restored into the now-empty editor accidentally.

The editor delegates unhandled input to pi's `CustomEditor`, preserving app shortcuts, autocomplete, prompt history, paste handling, and image paste.

## Compatibility and limitations

Cursor-restoring undo and redo currently use a defensive compatibility shim around pi-tui editor internals because pi-tui exposes `getCursor()` but not a public cursor setter or complete snapshot-restore API. If those internals change, the extension falls back to restoring text through the public API; cursor restoration may then use pi-tui's default position.

The extension captures the previously configured editor factory and restores it on session shutdown only if its own factory is still active. While loaded, however, it replaces rather than wraps an existing custom editor, so editor-extension load order matters.

Shortcut conflicts:

- `Ctrl+Z` performs undo instead of pi's default suspend action while focus is in this editor.
- `Ctrl+Y` performs redo instead of yank-pop; use `Alt+Y` for yank-pop.

## Requirements

This extension is active only in interactive TUI mode.

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/prompt-undo-redo/
```

Run `/reload` or restart pi after installation.
