# Prompt Truly Mine

Most of this extension was written with the pi agent CLI.

Adds `$` skill and prompt-template references and inline extension-command autocomplete to pi's prompt editor. Undo and redo restore both text and cursor position.

[Back to the extension workspace](../../README.md)

## `$` skill and prompt-template references

Skills and prompt templates attach with `$`, like Codex. Type `$` anywhere in the draft, including at the start, to open a menu of loaded skills (by bare name, such as `$angular-developer`) and file-based prompt templates (such as `$review`), labelled `[skill]` or `[prompt]`. Results are fuzzy-filtered and highlighted.

Use `Enter` or `Tab` to insert the selected reference without submitting the draft, then keep writing or add more:

```text
Implement this with $angular-developer $review
```

Only names of loaded skills and templates count as references; anything else after `$` (`$HOME`, `$1`, `US$5`, `$review/src`) stays literal text. If a skill and a prompt template share a name, `$name` attaches the skill: the menu entry says so, and submitting warns about the clash.

`/` is for commands only. The start-of-prompt `/` menu no longer lists skills or prompt templates, and the old forms are retired: submitting `/skill:name …`, or a draft that starts with `/template`, is blocked, keeps the draft, and shows a hint such as “Skills attach with $name now. Try $angular-developer”. A `/review` in the middle of a prompt is ordinary text.

## Inline extension commands

Typing `/` after existing prompt text or on a later line opens a filtered menu of extension commands, such as `/ask` or `/websearch`. Built-in commands are excluded.

Selecting an extension command inline inserts it without submitting the draft. When you submit, Prompt Truly Mine moves the first referenced extension command to the beginning. It passes the complete original draft as the command's arguments, including the inline command verb:

```text
hi please /ask test
→ /ask hi please /ask test
```

Pi then dispatches the real extension command. Extension-generated user messages are not promoted again, which prevents the preserved verb from recursively invoking the command. Additional extension-command tags remain arguments to the first command. Extension source files are never loaded as context or expanded into the prompt.

`@` attachment search, forced Tab path completion, prompt history, paste handling, image paste, and app shortcuts continue to delegate to pi's `CustomEditor`.

## Context references

When a draft is submitted, the extension finds every `$` reference, at the start or anywhere in the text. The model receives **your request first, byte-for-byte unchanged**, followed by a short list of the referenced files to read:

```text
Implement this with $angular-developer $review

<!-- pi-extension:inline-context:v2 -->
<context-references>
The request above references these resources. Read each file before acting on the request, then apply it to the request above.
- Skill `$angular-developer`: ~/.agents/skills/angular-developer/SKILL.md (relative paths inside it resolve against ~/.agents/skills/angular-developer)
- Prompt template `$review`: ~/.pi/agent/prompts/review.md (its $ARGUMENTS, $@, and $1, $2, … placeholders refer to the request above)
</context-references>
```

The agent then loads each file with its own `read` tool, after it has seen the request. This also works for skills hidden from the system prompt with `disable-model-invocation: true`, because the note carries the path. Prompt-template placeholders are resolved by the agent from the request; the extension does not substitute them. Pi never expands `$name` itself, so a reference at the start of the draft is handled exactly like one in the middle.

Repeated references are listed once. Unknown names and paths such as `$review/src` or `/ask/file.ts` remain ordinary text; a path never invokes a command or references a resource. If a registered resource is unreadable, the extension warns, lists the other valid resources, and preserves the draft. Messages already carrying the marker (including the older prepended-bundle format) are never rewritten twice.

## Copy-friendly composer

The editor is a filled card without horizontal rules or per-line prefixes. The draft surface shares the active theme's `userMessageBg` and `userMessageText` colors with sent user messages; the footer strip and suggestion panel are a shade darker (derived at render time in truecolor, `toolPendingBg`/`selectedBg` otherwise). Native scroll indicators take precedence over decorative labels. The status bar continues to show thinking effort.

Autocomplete appears **above** the composer, so opening, filtering, or closing suggestions does not move the bottom-anchored prompt in fullscreen mode. Suggestions are re-ranked by the shared [Pi Picker](../../packages/pi-picker/README.md) engine (word starts and consecutive letters first; ties keep Pi's order; items only Pi matched stay at the end), and the typed text is highlighted in names and descriptions. The panel draws Pi's native suggestion state: names align with the draft inset, the selected row is highlighted with `› `, descriptions drop Pi's `[u]`/`[p]` scope tags and are cut at word boundaries with `…`, and a final row shows the position (`2/6`) and keys (`↑↓ select  ⇥ complete  esc close`). Keyboard navigation and mouse hit testing stay native; the legend row ignores clicks. If the native list shape changes, the native menu rows are shown instead.

Horizontal spacing uses Pi's native `editorPaddingX` setting, in terminal character cells rather than pixels. Set `"editorPaddingX": 1` in `~/.pi/agent/settings.json` for equal one-cell left/right padding. Padding is visual only and never enters the submitted draft. Pi may draw the end-of-line cursor in the right padding cell. Very narrow terminals clamp padding to fit.

In fullscreen mode, the composer owns mouse selection over its own rows, so the inset is never selected or copied:

- Dragging highlights only draft cells and copies the source text, without the inset, soft-wrap line breaks, mode rail, footer labels, input hints, or cursor.
- Double-click selects a word; triple-click selects a logical line.
- A single click still positions the cursor.
- Copy follows Pi's `fullscreenCopyOnSelect` setting; with it off, use the copy key (`Ctrl+C` by default) while a selection is visible.
- Collapsed paste placeholders copy their full pasted contents.
- Typing or editing clears the selection.

Regular (non-fullscreen) mode leaves selection to the terminal emulator, which cannot be prevented from copying displayed padding cells.

The composer chrome, aligned to the draft inset:

```text
▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄   half-row padding
▎!ls                                                                draft bar
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   half-row padding
 ~/Work/alpha · main  shell  ⌃Z undo  ⌃Y redo     Claude Opus 5.5 · $4.2   footer bar (one row)
```

- **Half-row padding:** `▄`/`▀` half-block rows give the draft half a row of padding above and below, so it sits vertically centred. The draft bar's lower half-row shows the terminal background, leaving a thin gap above the footer, which is exactly one row and the last row on screen. Rows that carry native text (scroll or working indicators) stay full rows. In regular (non-fullscreen) mode, a terminal drag across those rows can copy the block glyphs; fullscreen selection never does.
- **Mode rail:** the one-cell left inset shows `▎` in the theme's `accent` color, or `bashMode` for `!`/`!!` commands, on each draft row. It stops at the draft so the half-row edge into the footer stays clean (one cell cannot hold the rail and two half colours). It needs `editorPaddingX` ≥ 1 and is never part of the draft.
- **Input hints:** an empty draft shows `/ commands  $ skills  ! shell  @ files` right-aligned in the draft row (dropped from the end on narrow terminals); they disappear on the first keystroke. There is no placeholder prompt text.
- **Footer bar:** one darker row reading `<dir> <mode> <hints>`: the directory, then `shell` or `shell · no context` for `!`/`!!` drafts, then `⌃Z undo  ⌃Y redo` right after an undo (until you edit again) or the `↓ N more` overflow indicator. Footer text is drawn closer to the footer colour than draft text is to the draft surface (in truecolor themes; hues are kept, so context warnings stay distinguishable).
- **Status line:** with [Compact Status Bar](../status-bar/README.md) loaded, its line fills the footer: `<dir · branch>  <mode>  <hints> · <extension statuses> … model · context · cost`, and Pi's separate footer row disappears. When space runs out the hints go first, then fields are shortened; the mode label outlives the directory. While a picker, selector, or overlay has focus, the status bar returns to its own row. The two extensions share only a global key (`Symbol.for("@stagefright5/pi-status-line/v1")`); neither imports the other.
- Native scroll indicators replace the top or bottom row where content is hidden. Theme changes apply at render time, including with Obsidian Ice.
- On exit, Pi erases the cursor by writing a plain space; the extension redraws that one cell in the composer color so the printed transcript has no black hole.

## Slash-command history

Submitted slash commands, including built-in commands and command arguments, are added to the editor's Up/Down recall before Pi dispatches them. Up/Down history survives `/reload`, `/new`, and session switches within the same Pi process. When Prompt History Search is also loaded, every session start, including a freshly launched Pi, also fills Up/Down with saved prompts and commands from all projects (newest first, up to Pi's 100-entry limit). History from the current Pi run comes first, and each prompt appears once. Seeding reads only the saved index, never scanning sessions at startup; until that index exists (after the first `Alt+R` or first submitted prompt), fresh processes start with in-process history only. Choosing a completion without submitting does not add a history entry. Native consecutive-duplicate suppression prevents commands that Pi already records from appearing twice.

When [Global Prompt History Search](../prompt-history-search/README.md) is also loaded, submissions are saved in its local 30-day index for `Alt+R` and `/prompt-history`. The extensions communicate through the `prompt-truly-mine:slash-submit` event; neither package imports or requires the other. History capture does not create conversation messages or invoke the model. Command arguments are stored verbatim (apart from outer whitespace), so do not put secrets in commands you do not want retained. Old commands that were never recorded cannot be recovered.

## Undo and redo

Shortcuts:

- `Ctrl+Z` undoes the last prompt edit.
- The configured `tui.editor.undo` key also undoes edits. It defaults to `Ctrl+-`.
- `Ctrl+Shift+Z` redoes an edit.
- `Ctrl+Y` also redoes an edit.

Behavior:

- Undo history stores prompt text, cursor position, and the payloads behind collapsed paste markers. Deleting a paste, replacing the draft, and undoing or redoing those edits retain the actual pasted content.
- The editor groups normal printable typing into runs. Whitespace, cursor movement, and other edits separate those runs.
- A new edit clears the redo stack.
- History records programmatic text replacement, inserted text, and autocomplete selections, including asynchronous single-match Tab completion and mouse selection. Mouse cursor movement also breaks typing groups.
- The editor retains up to 200 undo and 200 redo snapshots.
- The editor clears history after submission, including remapped submit keys and backslash-Enter, so you cannot accidentally restore a sent message into the empty editor.
- Undo and redo hints appear in the composer footer once an undo makes redo available.

## Context size and trust

The extension references only `skill` and `prompt` resources pi has already discovered. It never points the agent at arbitrary slash paths. Project-local resources remain subject to pi's project-trust rules.

Loading several full resources and substituting the whole draft into prompt templates can use a lot of context. The extension loads each resource only once, but you should select only relevant skills and prompts and explicitly resolve conflicting instructions.

## Compatibility and limitations

This extension develops against pi and pi-tui **1.2.0**; the editor and history integration tests also pass against **1.3.0**. The composer uses protected editor-border hooks and a validated native menu-layout shim. Older runtime compatibility is not covered by this version's tests.

Cursor/paste restoration, history retention, composer-owned selection, above-composer autocomplete placement, inline `/` autocomplete, and Enter selection without submission use compatibility shims because pi-tui does not currently expose complete public APIs for those operations. Private access is isolated in `editor-compat.ts` and runtime-validated rather than asserted through an invented SDK type. If internals change:

- undo/redo falls back to restoring expanded text through the public API, preserving pasted content but possibly losing collapsed markers and exact cursor placement
- inline `/` may require explicit Tab completion until the shim is updated
- autocomplete falls back to native placement if the rendered menu geometry no longer matches
- selection falls back to Pi's screen selection (which includes the inset) if the native row map is unavailable
- the suggestion panel falls back to native menu rows if the native autocomplete list shape changes
- the exit-cell repair only applies when Pi's regular-screen renderer still erases the cursor with a single space
- Up/Down history starts empty after reload if the native history field changes
- normal editor input remains exception-safe

For extremely narrow terminals with fewer than two usable text columns, a bounded cursor row replaces native wrapping to avoid a pi-tui 1.2.0 wide-character recursion bug. The normal editor and autocomplete layout return when the terminal is widened; the stored draft is unchanged.

The extension captures the previously configured editor factory and restores it on session shutdown only if its own factory remains active. Factory handoffs preserve expanded pasted content, and repeated startup/shutdown notifications do not stack editor installations. While loaded, it replaces rather than wraps an existing custom editor, so editor-extension load order still matters.

Shortcut conflicts:

- `Ctrl+Z` performs undo instead of pi's default suspend action while focus is in this editor.
- `Ctrl+Y` performs redo instead of yank. Rebind `tui.editor.yank` to another key if needed; `Alt+Y` retains native yank-pop behavior after a yank.

Automatic inline autocomplete requires interactive TUI mode. Context-tag expansion also applies to prompts submitted through other modes when the extension is loaded.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-prompt-truly-mine
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/prompt-truly-mine` or expose it through the workspace's development symlink. Run `/reload` after source changes.
