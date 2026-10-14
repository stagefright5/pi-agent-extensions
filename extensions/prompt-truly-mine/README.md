# Prompt Truly Mine

Most of this extension was written with the pi agent CLI.

Adds inline extension-command autocomplete and skill and prompt context tags to pi's prompt editor. Undo and redo restore both text and cursor position.

[Back to the extension workspace](../../README.md)

## Inline context autocomplete

At the beginning of the first editor line, `/` keeps pi's normal autocomplete menu with commands, prompt templates, and enabled skill commands.

Typing `/` after existing prompt text or on a later line opens a filtered menu containing:

- extension commands, such as `/ask` or `/websearch`
- loaded skills, such as `/skill:angular-developer`
- file-based prompt templates, such as `/review`

The inline menu excludes built-in commands. It fuzzy-filters results by invokable name and labels them as `[extension]`, `[skill]`, or `[prompt]`.

Use `Enter` or `Tab` to insert the selected item without submitting the draft. You can then add more tags or continue writing:

```text
Implement this with /skill:angular-developer /review
```

Selecting a skill or prompt template from the normal start-of-prompt menu also inserts it without submitting. Leading extension commands retain pi's normal behavior.

Selecting an extension command inline inserts it without submitting the draft. When you submit, Prompt Truly Mine moves the first referenced extension command to the beginning. It passes the complete original draft as the command's arguments, including the inline command verb:

```text
hi please /ask test
→ /ask hi please /ask test
```

Pi then dispatches the real extension command. Extension-generated user messages are not promoted again, which prevents the preserved verb from recursively invoking the command. Additional extension-command tags remain arguments to the first command. Extension source files are never loaded as context or expanded into the prompt.

`@` attachment search, forced Tab path completion, prompt history, paste handling, image paste, and app shortcuts continue to delegate to pi's `CustomEditor`.

## Context expansion

When a draft is submitted, the extension finds every registered skill and prompt-template tag at the start or within the text. It then:

1. loads each uniquely referenced source file
2. strips its frontmatter
3. expands prompt-template placeholders
4. prepends one delimited context bundle
5. appends the original draft unchanged, including every slash tag

For this draft, the model receives the full skill and prompt-template content followed by the unchanged task:

```text
Implement this with /skill:angular-developer /review
```

Repeated tags remain in the original task, but the extension loads each source file only once. Unknown tags remain ordinary text. If a registered resource becomes unreadable, the extension warns, loads the other valid resources, and preserves the draft.

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

## Copy-friendly composer

The editor uses a clean filled surface without horizontal rules or a composer label. Shell commands retain a quiet `shell` mode indicator. There are **no added prompt glyphs, side borders, per-line prefixes, or content indentation**. Pi's dedicated border hooks provide blank top/bottom padding and space for labels without changing native editor geometry. The rendered editor, including its autocomplete menu, shares the active theme's `userMessageBg` and `userMessageText` colors with sent user messages. Only ANSI color wrappers are added to native rows: content, spacing, cursor markers, autocomplete selection styles, and row geometry are preserved. Native scroll indicators take precedence over decorative labels. The status bar continues to show thinking effort; the composer does not draw a separate colored border.

Undo/redo hints (`ctrl+z undo` and `ctrl+y redo`) appear at the top right only when available and when they fit. The bottom padding stays blank, without a rule. Shortcut, shell, and overflow labels use the active theme's `muted` text color rather than a dim decorative-rule color. Theme changes are read at render time. Hints never overwrite the final autocomplete row. The chrome follows the selected theme, including Obsidian Ice.

## Undo and redo

Shortcuts:

- `Ctrl+Z` undoes the last prompt edit.
- The configured `tui.editor.undo` key also undoes edits. It defaults to `Ctrl+-`.
- `Ctrl+Shift+Z` redoes an edit.
- `Ctrl+Y` also redoes an edit.

Behavior:

- Undo history stores both prompt text and cursor position.
- The editor groups normal printable typing into runs. Whitespace, cursor movement, and other edits separate those runs.
- A new edit clears the redo stack.
- History records programmatic text replacement, inserted text, and autocomplete selections.
- The editor retains up to 200 undo and 200 redo snapshots.
- The editor clears history after submission so you cannot accidentally restore a sent message into the empty editor.
- Undo and redo hints appear at the top right of the editor header when those actions are available.

## Context size and trust

The extension expands only `skill` and `prompt` resources pi has already discovered. It never loads arbitrary slash paths. Project-local resources remain subject to pi's project-trust rules.

Loading several full resources and substituting the whole draft into prompt templates can use a lot of context. The extension loads each resource only once, but you should select only relevant skills and prompts and explicitly resolve conflicting instructions.

## Compatibility and limitations

This extension targets pi and pi-tui **1.2.0**. The composer uses the protected editor-border hooks introduced in the newer runtime. Older runtime compatibility is not covered by this version's tests.

Cursor restoration, inline `/` autocomplete, and Enter selection without submission use compatibility shims because pi-tui does not currently expose complete public APIs for those operations. If internals change:

- undo/redo falls back to restoring text through the public API, possibly losing exact cursor placement
- inline `/` may require explicit Tab completion until the shim is updated
- normal editor input remains exception-safe

The extension captures the previously configured editor factory and restores it on session shutdown only if its own factory remains active. While loaded, it replaces rather than wraps an existing custom editor, so editor-extension load order still matters.

Shortcut conflicts:

- `Ctrl+Z` performs undo instead of pi's default suspend action while focus is in this editor.
- `Ctrl+Y` performs redo instead of yank-pop; use `Alt+Y` for yank-pop.

Automatic inline autocomplete requires interactive TUI mode. Context-tag expansion also applies to prompts submitted through other modes when the extension is loaded.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-prompt-truly-mine
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/prompt-truly-mine` or expose it through the workspace's development symlink. Run `/reload` after source changes.
