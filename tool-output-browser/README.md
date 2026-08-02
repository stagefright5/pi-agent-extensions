# Tool Output Browser

Opens one tool result at a time without changing pi's compact transcript view.

[Back to the extension collection](../README.md)

## Usage

Open the browser in TUI mode:

- `/tool-output` — browse tool outputs on the active session branch
- `/tool-output [initial filter]` — open with an optional filter

In the picker:

- type to filter by tool name, arguments, output, or result details
- `Up` / `Down` and `Page Up` / `Page Down` — navigate
- `Enter` — open the selected result
- `Escape` or `Ctrl+C` — close

In an opened result:

- `Up` / `Down` or `j` / `k` — scroll one visual line
- `Page Up` / `Page Down` or `Space` — scroll one page
- `Home` / `End` or `g` / `G` — jump to the start or end
- `Tab` / `Right` — switch among output, arguments, and details
- `n` / `p` — open the next or previous matching tool result
- `Escape` / `Left` — return to the picker
- `Ctrl+C` — close the browser

Pi's normal `Ctrl+O` remains unchanged and still expands or collapses every tool row in the transcript.

## Scope and limitations

The browser reads tool-result messages from the current active branch. Newest results appear first; results that exist only on alternate branches are not shown.

The output view shows the complete text stored in the tool-result message, rather than the compact preview rendered in the transcript. The arguments and details views expose the corresponding stored metadata. Image blocks are represented by a MIME-type marker instead of being rendered as terminal images.

This extension cannot toggle an existing transcript row inline: pi's public extension API exposes only the global tool-expansion state and does not expose focus or expansion state for individual built-in rows. The selector overlay is intentionally a non-invasive workaround.

Tool-level truncation still applies. If a tool stored only a truncated result (for example, a large `read` result), the browser cannot recover omitted content. For truncated `bash` output, use the full-output path recorded by pi when that temporary file is still available.

## Privacy

The extension reads only the active in-memory session branch and does not write or upload tool output. Output and metadata are rendered locally in the TUI.

## Requirements

Interactive TUI mode is required; overlays are unavailable in RPC, JSON, and print modes.

## Installation

Install the [complete collection](../README.md#install-the-complete-collection), or copy this directory to:

```text
~/.pi/agent/extensions/tool-output-browser/
```

Run `/reload` or restart pi after installation.
