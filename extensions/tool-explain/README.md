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

Run `/reload` after updating the extension. Then run `/tool-explain` to open the searchable picker in a [Pi Dialog](../../packages/pi-dialog/README.md) popup; its subtitle summarizes the current selection. Use arrow keys to navigate, Enter to toggle, and Esc to close.

The picker has two modes:

- All is the default. It includes future tools. Disable individual tools to exclude them.
- Selected explains only the enabled tool names. Switching from All copies the enabled names into a list. Switching back to All enables every tool.

The picker atomically saves each change to the owner-only `getAgentDir()/tool-explain.json`, never rewriting Pi's shared settings. Effective merged `toolExplain` settings (or legacy `codemodeExplain.model`) remain defaults; the separate file overrides saved selections. Settings actions begin at `session_start`, not during extension loading. Closing the picker reloads extensions if you changed a choice, so existing rows use the new settings too.

Unselected tools keep their original rendering and make no summary requests. The native `edit` renderer is supported: its diff stays available when expanded. Other renderers that own their shell (`renderShell: "self"`) retain their renderer unchanged; they are not forced into the default box. Select no tools to disable explanations. Saved tool names remain in the picker even when those tools are not registered.

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
✓ bash tool completed: Run the extension tests and TypeScript checks

Took 2.3s
```

While arguments stream, the header reads `Calling <tool_name> tool…`; during execution it reads `Running <tool_name> tool…`. Completed and failed calls read `<tool_name> tool completed` and `<tool_name> tool failed`. The tool name uses bold tool-title styling, separate from the muted status text.

Press `Ctrl+O` or click to expand a row. The summary appears above the tool's original arguments and output, including edit diffs. Tools without custom renderers show JSON arguments and the full text result.

Failures remain visible while collapsed. The extension shows the tool's first error line without a model request. If no summary is available, the header shows the tool name and status. Expand the row for details.

### Codemode

Codemode rows also show the number of nested calls, their status, and elapsed or total time. The header changes as the script runs:

| Phase                                  | Header                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| The model writes the script            | `⠋ Calling codemode tool…`                                            |
| The script runs                        | `◐ Running codemode tool…`, then `◐ Running codemode tool: <summary>` |
| The script finishes before the summary | `✓ codemode tool completed: ●∙∙`                                      |
| The script succeeds                    | `✓ codemode tool completed: <summary>`                                |
| The script fails                       | `✗ codemode tool failed: <summary>`                                   |

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

Use `/reload` after manually editing model/settings files. Configuration is loaded once per session; tool calls do not reread settings files. If the configured model is unavailable or a request fails, Pi shows one warning per session. With neither a configured summary model nor a current model, it silently skips summaries. Affected rows have no summary.

## Requests and saved summaries

Each distinct selected top-level call makes one small model request with up to 12,000 characters of input. The request asks for minimal reasoning (clamped to what the model supports) and returns the summary through a structured `label` tool call, so the model's working text never becomes the summary. There is no output token cap beyond the model's own limit. A reply without a label marks the row as failed. Every tool, including codemode, sends its name, arguments, and description, but not its results; for codemode the arguments are the script. Arguments may contain sensitive data. The summary model receives that data. Usage is recorded in durable `extension-model-usage` session entries and included by Compact Status Bar without delaying tools. Pi's built-in `/session` totals do not include these custom entries: 1.3.0 exposes no native usage-append action for asynchronous UI work.

Reported usage is retained even when a summary is cancelled. During session teardown, requests are aborted and given up to one second to return usage before the old runtime is closed; late results never write into a replacement session. Providers that omit usage or ignore cancellation past that grace period can still cause under-reporting, so these totals are not a billing ledger.

Repeated calls reuse summaries by tool name and arguments. The extension saves summaries as `tool-explain` custom session entries, so resumed sessions reuse them too. These entries do not enter the conversation context.

Nested calls do not make separate summary requests or get separate summary rows. They keep their original display within the parent's expanded output.

## Limitations

- Summary requests run only in the interactive TUI. Print, JSON, and RPC modes make no requests.
- Pi renders images separately, so they may remain visible in collapsed rows.
- Invalid settings disable explanations and produce a warning. The extension does not overwrite the invalid file.
- HTML exports draw the call before its result. The header therefore shows the running state without failure lines. The expanded result still shows the tool's original output.
