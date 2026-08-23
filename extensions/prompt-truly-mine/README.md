# Prompt Truly Mine

DISCLAIMER: This is *mostly* vibe-coded using pi agent cli

Makes pi's prompt editor truly yours with composable skill/prompt context tags plus cursor-restoring undo and redo.

[Back to the extension workspace](../../README.md)

## Inline context autocomplete

At the beginning of the first editor line, `/` keeps pi's normal autocomplete menu with commands, prompt templates, and enabled skill commands.

After existing prompt text—or on a later line—typing `/` opens a filtered menu containing only:

- loaded skills, such as `/skill:angular-developer`
- file-based prompt templates, such as `/ask`

Built-in and extension commands are intentionally excluded from the inline menu. Results are fuzzy-filtered by invokable name and labeled as `[skill]` or `[prompt]`.

Use `Enter` or `Tab` to insert the selected tag without submitting the draft. You can then add more tags or continue writing:

```text
Implement this with /skill:angular-developer /ask
```

Selecting a skill or prompt template from the normal start-of-prompt menu also inserts it without submitting. Leading ordinary commands retain pi's normal behavior.

`@` attachment search, forced Tab path completion, prompt history, paste handling, image paste, and app shortcuts continue to delegate to pi's `CustomEditor`.

## Context expansion

When a draft is submitted, the extension finds every registered skill and prompt-template tag at the start or within the text. It then:

1. loads each uniquely referenced source file
2. strips its frontmatter
3. expands prompt-template placeholders
4. prepends one delimited context bundle
5. appends the original draft **verbatim**, including every slash tag

For example, the model receives both full resource bodies and the unchanged task for:

```text
Implement this with /skill:angular-developer /ask
```

Repeated tags remain in the original task but their source body is loaded only once. Unknown tags remain ordinary text. If a registered resource becomes unreadable, the extension warns, loads the other valid resources, and preserves the draft.

The combined bundle uses pi's existing collapsible skill-invocation envelope. Expanded content labels each section as a skill or prompt template and records its source path. Skill sections also state the base directory for resolving relative references.

### Prompt-template arguments

Every selected prompt template receives the complete original draft as its argument string. Argument parsing and substitution mirror pi's template behavior:

- quoted text becomes one positional argument
- `$1`, `$2`, and later positional placeholders are supported
- `$@` and `$ARGUMENTS` receive all parsed arguments joined with spaces
- default forms such as `${1:-default}` and `${ARGUMENTS:-default}` are supported
- slices such as `${@:2}` and `${@:2:3}` are supported
- substituted values are not recursively expanded

The expanded template uses pi-style normalized arguments, while the separately appended user task remains byte-for-byte unchanged.

## Undo and redo

Shortcuts:

- `Ctrl+Z` — undo the last prompt edit
- configured `tui.editor.undo` key — undo (`Ctrl+-` by default)
- `Ctrl+Shift+Z` — redo
- `Ctrl+Y` — redo

Behavior:

- Undo history stores both prompt text and cursor position.
- Normal printable typing is coalesced into runs; whitespace, cursor movement, and other edits create useful boundaries.
- A new edit clears the redo stack.
- Programmatic text replacement, inserted text, and autocomplete selections are recorded.
- Up to 200 undo and 200 redo snapshots are retained.
- History is cleared after submission so a sent message cannot be restored into the empty editor accidentally.
- Compact undo/redo hints appear in the editor's bottom border when those actions are available.

## Context size and trust

Only `skill` and `prompt` resources already discovered by pi are eligible for expansion; arbitrary slash paths are never loaded. Project-local resources therefore remain subject to pi's project-trust rules.

Loading several full resources—and substituting the whole draft into prompt templates—can consume significant context. Resource bodies are deduplicated, but users should select only relevant skills/prompts and resolve conflicting instructions explicitly.

## Compatibility and limitations

This extension targets pi and pi-tui **0.84.2**.

Cursor restoration, natural inline `/` triggering, and composable Enter selection use narrow defensive compatibility shims because pi-tui does not currently expose complete public APIs for those operations. If internals change:

- undo/redo falls back to restoring text through the public API, possibly losing exact cursor placement
- inline `/` may require explicit Tab completion until the shim is updated
- normal editor input remains exception-safe

The extension captures the previously configured editor factory and restores it on session shutdown only if its own factory remains active. While loaded, it replaces rather than wraps an existing custom editor, so editor-extension load order still matters.

Shortcut conflicts:

- `Ctrl+Z` performs undo instead of pi's default suspend action while focus is in this editor.
- `Ctrl+Y` performs redo instead of yank-pop; use `Alt+Y` for yank-pop.

Natural autocomplete requires interactive TUI mode. Context-tag expansion also applies to prompts submitted through other modes when the extension is loaded.

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-prompt-truly-mine
```

For source development, load this directory with `pi -e ./extensions/prompt-truly-mine` or expose it through the workspace's development symlink. Run `/reload` after source changes.
