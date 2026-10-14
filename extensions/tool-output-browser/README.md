# Tool Output Browser

Most of this extension was written with the pi agent CLI.

Opens one tool result at a time without changing pi's compact transcript view.

[Back to the extension workspace](../../README.md)

## Usage

Open the browser in TUI mode:

- Run `/tool-output` to browse tool outputs on the active session branch.
- Run `/tool-output [initial filter]` to open with an optional filter.

In the picker:

- Type to filter by tool name, arguments, output, or result details.
- Press `Up` / `Down` and `Page Up` / `Page Down` to navigate.
- Press `Enter` to open the selected result.
- Press `Escape` or `Ctrl+C` to close.

In an opened result:

- Press `Up` / `Down` or `j` / `k` to scroll one visual line.
- Press `Page Up` / `Page Down` or `Space` to scroll one page.
- Press `Home` / `End` or `g` / `G` to jump to the start or end.
- Press `Tab` / `Right` to switch among output, arguments, and details.
- Press `n` / `p` to open the next or previous matching tool result.
- Press `Escape` / `Left` to return to the picker.
- Press `Ctrl+C` to close the browser.

Pi's normal `Ctrl+O` remains unchanged and still expands or collapses every tool row in the transcript.

## Appearance

Open-sided panels use thin horizontal separators rather than enclosing boxes. Selection is highlighted with the theme's selection surface; active detail tabs use an understated accent underline. Metadata stays quiet, errors remain conspicuous, and narrow windows get compact help text. The overlay reads the current theme when rendering, so switching themes does not leave cached colors behind.

Rendering and navigation are tested against pi 1.2.0, including tiny widths and 40/80/120/160 columns, long output, CJK, combining characters, and emoji. The interface retains all navigation keys listed above even when short help text omits them.

## Scope and limitations

The browser reads tool-result messages from the current active branch. Newest results appear first; results that exist only on alternate branches are not shown.

The output view shows the complete text stored in the tool-result message, rather than the compact transcript preview. The arguments and details views show the corresponding stored metadata. The browser shows image blocks as MIME-type markers, not terminal images.

The browser uses an overlay because pi's public extension API exposes only the global tool-expansion state. It cannot focus or expand individual built-in transcript rows.

Tool-level truncation still applies. If a tool stored only a truncated result, such as a large `read` result, the browser cannot recover omitted content. For truncated `bash` output, use the full-output path recorded by pi when that temporary file is still available.

## Privacy

The extension reads only the active in-memory session branch and does not write or upload tool output. It displays output and metadata locally in the TUI.

## Requirements

Interactive TUI mode is required; overlays are unavailable in RPC, JSON, and print modes.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-tool-output-browser
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/tool-output-browser` or expose it through the workspace's development symlink. Run `/reload` after source changes.
