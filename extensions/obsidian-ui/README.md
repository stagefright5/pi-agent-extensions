# Obsidian UI

Compact tool rows that follow the active Pi theme. No fixed palette is bundled. It does not require font patches or add animation or user-message prefixes.

[Back to the extension workspace](../../README.md)

## Theme

Select `terminal-native` under **Theme** in `/settings`. With this extension loaded, panel shades are derived from the terminal's reported background, preserving its tint rather than introducing a fixed blue, green, or red fill:

- Tool panels blend 7% toward white on dark terminals, or toward black on light terminals. Pending, success, and error states share the same shade.
- Composer and user/custom messages use an 11% blend so they stand out a little more.
- Selection/search uses an 18% blend for stronger interaction feedback.
- Body text keeps the terminal's default foreground. Status icons, errors, warnings, diffs, and syntax retain ANSI palette colors.

The extension queries terminal colors on activation and on terminal appearance notifications, then installs an in-memory theme through Pi's public API. It uses a zero-row widget to observe theme selection without replacing the editor or footer. No polling, terminal configuration changes, generated theme-file writes, or host patches are used. Listeners and pending updates are cleaned up on reload/shutdown.

If the terminal does not report a background, or the JSON theme is loaded without the extension, message/tool panels fall back to the terminal's default background and selection/search to ANSI slot 8. Late color replies still apply. Live updates depend on the terminal emitting appearance notifications; run `/reload` after palette-only changes that it does not report. Contrast depends on the terminal's foreground and palette; no blanket contrast guarantee is made.

The extension uses semantic tokens from the active theme for headers, status indicators, previews, and native tool backgrounds. It only derives surfaces while `terminal-native` is selected; other selected Pi themes are left alone. The terminal still controls its font, opacity, and native selection behavior.

The former `obsidian-ice` palette is no longer shipped. If upgrading from it, select `terminal-native` in `/settings`. For a source-linked installation, also remove the old `~/.pi/agent/themes/obsidian-ice.json` symlink if you created one.

User/assistant messages retain pi's native layout and Markdown. This extension does not insert labels or rails into user content or rewrite transcripts. Native Markdown rendering and terminal selection can still differ from the raw stored text.

## Tool presentation

- Native `read`, `write`, `grep`, `find`, and `ls` calls get compact, width-aware headers with path/query, actual result counts, state, and recorded duration when available.
- Collapsed reads show a three-visual-row preview; expanded reads keep native syntax highlighting and complete stored output.
- Expanded writes retain their native code preview. Errors and native search-limit notices remain visible.
- Truncated reads keep continuation instructions and full-output locations visible even while collapsed. This includes user-limited reads with more lines available and oversized-line recovery instructions.
- Native shell rendering remains intact, including its five-row preview and timing. Edit keeps its live diff preview and self-managed shell. Both inherit the palette.
- Codemode, interactive tools, and custom/MCP tools with specialized renderers retain those renderers. Unknown tools without renderers receive a compact fallback with full stored text and arguments on expansion.
- Native expansion controls, click handling, and inline images are owned by pi. No executable tools, schemas, results, or model-facing content are replaced.

Renderer state is scoped to each call; there are no timers or background processes. Delegated native output is bounded to the available width, including zero- and one-column viewports with wide characters. Switching themes, streaming, parallel calls, and resumed sessions are supported.

## Matching composer, footer, and browser

Companion packages provide the composer, footer, and output browser:

- [Prompt Truly Mine](../prompt-truly-mine/README.md): matching user-message surface and text colors, without horizontal rules, leading glyphs, side rails, or added content indentation.
- [Compact Status Bar](../status-bar/README.md): context and extension-status priority on narrow terminals.
- [Tool Output Browser](../tool-output-browser/README.md): open-sided, lightly framed output panels.

Obsidian UI does not replace their editor or footer factories. Each companion also works with other pi themes.

## Compatibility

Terminal-derived surfaces are tested against **pi 1.5.2** and require its public TUI color-query and appearance-notification APIs. Older runtimes without `registerToolRenderer` receive a TUI warning instead of replacement tool registrations. We do not claim full compatibility with older pi versions.

Tests use Node 24's experimental TypeScript transform because the existing editor/browser implementations use constructor parameter properties. No compiler or additional runtime dependency is required when pi loads these sources.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-obsidian-ui
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/obsidian-ui` or expose it through the workspace's development symlink. When using only the extension-directory symlink, also link `themes/terminal-native.json` from this package into `~/.pi/agent/themes/terminal-native.json`. Package discovery exposes it automatically, so do not add the extra link for a package installation. Run `/reload` after source changes, then select `terminal-native` in `/settings`.

## Uninstall

Select `system` (or another installed theme) in `/settings`, disable this extension through `pi config`, and reload. Remove the `terminal-native.json` theme symlink if you created it for source development. Companion chrome changes are independent; revert their presentation changes separately to restore their old appearance. No session migration is needed.
