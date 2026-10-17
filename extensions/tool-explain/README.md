# Tool explain

Replaces collapsed tool arguments and text output with an AI summary, timing, and errors. A small model writes the summary while the tool runs.

The extension covers all top-level tools by default, including built-ins, extension tools, and MCP tools. Use `/tool-explain` to choose which tools it explains.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-tool-explain
```

<!-- package-tools:install:end -->

## Choose tools

Run `/reload` after updating the extension. Then run `/tool-explain` to open the searchable picker. Use arrow keys to navigate, Enter to toggle, and Esc to close.

The picker has two modes:

- All is the default. It includes future tools. Disable individual tools to exclude them.
- Selected explains only the enabled tool names. Switching from All copies the enabled names into a list. Switching back to All enables every tool.

The picker saves each change to `~/.pi/agent/settings.json`, or to your configured agent directory. It preserves other settings and your explanation model. Closing the picker reloads extensions if you changed a choice, so existing rows use the new settings too.

Unselected tools keep their original rendering and make no summary requests. Select no tools to disable explanations. Saved tool names remain in the picker even when those tools are not registered.

You can also edit settings and run `/reload`. This example explains every tool except `read` and `job_status`:

```json
{
  "toolExplain": {
    "tools": "all",
    "excludeTools": ["read", "job_status"]
  }
}
```

To explain only specific tools, set `"tools": ["codemode", "bash", "edit"]`. Names must match exactly. Glob patterns are not supported.

## Read tool rows

Collapsed rows hide arguments and text output:

```text
✓ bash executed: Run the extension tests and TypeScript checks

Took 2.3s
```

Press `Ctrl+O` or click to expand a row. The summary appears above the tool's original arguments and output, including edit diffs. Tools without custom renderers show JSON arguments and the full text result.

Failures remain visible while collapsed. The extension shows the tool's first error line without a model request. If no summary is available, the header shows the tool name and status. Expand the row for details.

### Codemode

Codemode rows also show the number of nested calls, their status, and elapsed or total time. The header changes as the script runs:

| Phase                                  | Header                                                  |
| -------------------------------------- | ------------------------------------------------------- |
| The model writes the script            | `⠋ Writing codemode tool call…`                         |
| The script runs                        | `◐ Executing code…`, then `◐ Executing code: <summary>` |
| The script finishes before the summary | `✓ Codemode executed: ●∙∙`                              |
| The script succeeds                    | `✓ Codemode executed: <summary>`                        |
| The script fails                       | `✗ Codemode failed: <summary>`                          |

Summaries use the theme's accent color beside a muted label. Long summaries wrap rather than truncate. Expand a row to see the highlighted script, nested calls, and output.

Each failed nested call adds a line below the header. It shows the tool name, an identifying argument of up to 60 characters, and the first error line. Bash failures also show the exit code, such as `(exit 1)`. A nonzero exit code counts as a failure.

Collapsed rows show the first three failed calls and `+N more failed`. Expanded rows show every failure. A script error appears last as `✗ Script error: <message>` and does not count toward the three-call limit. Failure text uses the theme's dim color and the terminal's faint style. The `✗` uses the error color.

## Choose a model

By default, the extension uses the cheapest available text model from your session's provider. To choose a model, add its provider and ID to `~/.pi/agent/settings.json`:

```json
{
  "toolExplain": { "model": "anthropic/claude-haiku-4-5" }
}
```

If the configured model is unavailable or a request fails, Pi shows one warning per session. Affected rows have no summary.

## Requests and saved summaries

Each distinct selected top-level call makes one small model request with up to 12,000 characters of input and no reasoning. Codemode sends the script. Other tools send their name, description, and arguments, but not their results. Arguments may contain sensitive data. The summary model receives that data. Pi's footer does not include these requests in the session cost.

Repeated calls reuse summaries by tool name and arguments. The extension saves summaries as `tool-explain` custom session entries, so resumed sessions reuse them too. These entries do not enter the conversation context.

Nested calls do not make separate summary requests or get separate summary rows. They keep their original display within the parent's expanded output.

## Limitations

- Summary requests run only in the interactive TUI. Print, JSON, and RPC modes make no requests.
- Pi renders images separately, so they may remain visible in collapsed rows.
- Invalid settings disable explanations and produce a warning. The extension does not overwrite the invalid file.
- HTML exports draw the call before its result. The header therefore shows the running state without failure lines. The expanded result still shows the tool's original output.
