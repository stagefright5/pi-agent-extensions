# Codemode Explain

Shows a one-line summary instead of the script in collapsed `codemode` rows, plus a one-line status in place of the nested calls and output. A small model writes the summary while the script runs.

```text
✓ Codemode executed: Read package metadata and Git history, count TypeScript files, and test a
missing file
✗ bash sleep 1; cat /nonexistent-demo-file — cat: /nonexistent-demo-file: No such file or directory
(exit 1)

5 calls · 1 failed · Took 7.1s
```

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-codemode-explain
```

<!-- package-tools:install:end -->

## Usage

There is nothing to run. A collapsed row never shows code. Its header changes as the call progresses, with a different animation for each loading phase:

| Phase                       | Header                                                                            |
| --------------------------- | --------------------------------------------------------------------------------- |
| The model writes the script | `⠋ Writing codemode tool call…`                                                   |
| The script runs             | `◐ Executing code…`, then `◐ Executing code: <summary>` once the summary is ready |
| Done, summary still pending | `✓ Codemode executed: ●∙∙`                                                        |
| Done                        | `✓ Codemode executed: <summary>` (`✗ Codemode failed: …` when the script fails)   |

The summary is drawn in the theme's accent color beside a muted label, so it stands out, and it always wraps onto more lines rather than being cut off. Below the header, the status counts nested calls, running and failed ones, and shows the elapsed or total time.

### Failures

Each failed nested call gets its own line under the header: the tool, the argument that identifies the call (its command, path, URL, or query, up to 60 characters), and the first line of the tool's own error. For bash, the exit code is added, as in `(exit 1)`. A bash command that exits with a non-zero code counts as failed. These lines come straight from the result, with no model request, and appear as soon as a call fails, even while the script is still running.

Collapsed rows show the first three failed calls and `+N more failed`. Expanded rows show all of them above the script. When the script itself fails, a `✗ Script error: <message>` line comes last and is always shown, outside the three-line limit. Failure lines are drawn quietly, in the theme's dim color with the terminal's faint style, so they sit below the summary. Only the `✗` mark keeps the error color.

Expand the row (`Ctrl+O` or click) to see the same header and failure lines above the full highlighted script, followed by pi's full list of nested calls and output. If no summary exists, for example for scripts from before you installed the extension or when a request failed, the header reads `Codemode executed` and the script is available by expanding.

### Model

By default, the summary comes from the cheapest available model from the provider you are using. For example, Anthropic sessions use a Haiku model. To use a specific model, add this to `~/.pi/agent/settings.json`:

```json
{
  "codemodeExplain": { "model": "anthropic/claude-haiku-4-5" }
}
```

If that model is not available, or a summary request fails, pi shows one warning for the session and the row header has no summary.

## Notes

- Each new script costs one small model request (at most 12,000 characters of script, no reasoning). Pi does not include these requests in the session cost shown in the footer.
- Summaries only run in the interactive TUI. Print, JSON, and RPC modes make no requests.
- Summaries are saved in the session as `codemode-explain` custom entries, so resumed sessions show them again without new requests. These entries are not sent to the model.
- HTML exports render the header as it looks while the script runs, without failure lines, because exports draw the call before its result. The export's result section still lists every error.
