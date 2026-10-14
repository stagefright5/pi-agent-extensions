# Obsidian UI

A restrained graphite-and-ice interface for pi: off-white text, cyan focus, soft violet syntax, subtle message surfaces, and compact tool presentation. No font patches, decorative animation, or added user-message prefixes.

[Back to the extension workspace](../../README.md)

## Theme

Select **obsidian-ice** in `/settings`. The package exposes `themes/obsidian-ice.json` as a pi theme. Selecting another theme changes the palette without disabling compact tool presentation.

The terminal still controls its overall background, font, and native selection behavior. This palette is designed for a dark terminal; it does not modify Ghostty or other terminal settings. The contrast tests cover normal text, syntax, secondary metadata, and selection/search text at **4.5:1**, plus meaningful borders, mode indicators, selection markers, and the scrollbar thumb at **3:1**. Tests measure pi's emitted colors in both truecolor and 256-color modes rather than assuming RGB values survive palette approximation.

User messages and the companion composer share a dark, cool-charcoal surface (`#2e3337`); normal tool calls use near-black blue-charcoal (`#191e22`). This deliberately avoids medium-gray cards. The subtle cool tint becomes separate dark grayscale entries in 256-color mode instead of collapsing both surfaces to black. Separate surface-separation regression checks require **1.25:1 between user and tool surfaces** and **1.1:1 between normal tool surfaces and the reference terminal background**, with darkness limits to prevent the gray-card treatment returning. These are design thresholds, not WCAG requirements for adjacent backgrounds. Tool errors retain their rose-tinted surface and status indicators.

Selection/search and scrollbar-track surfaces also use a narrow cool tint so 256-color conversion does not turn them into unexpectedly bright blue-gray backgrounds. Secondary text uses silver; decorative separators can remain subtle. The matching composer has no horizontal rules or side rails; shortcut/shell/overflow labels remain readable within its filled surface.

These checks use the theme's panel backgrounds, the export-page background, and the configured Arizona Monsoon terminal background (`#0a0f14`) as **opaque references**. Window transparency, wallpaper, terminal palette overrides, and third-party hardcoded styles can affect actual contrast. This is not a claim of complete WCAG conformance. No terminal opacity or configuration is changed.

User/assistant messages retain pi's native layout and Markdown. This extension does not insert labels or rails into user content or rewrite transcripts. Native Markdown rendering and terminal selection can still differ from the raw stored text.

## Tool presentation

- Native `read`, `write`, `grep`, `find`, and `ls` calls get compact, width-aware headers with path/query, actual result counts, state, and recorded duration when available.
- Collapsed reads show a three-visual-row preview; expanded reads keep native syntax highlighting and complete stored output.
- Expanded writes retain their native code preview. Errors and native search-limit notices remain visible.
- Truncated reads keep continuation instructions and full-output locations visible even while collapsed.
- Native shell rendering remains intact, including its five-row preview and timing. Edit keeps its live diff preview and self-managed shell. Both inherit the palette.
- Codemode, interactive tools, and custom/MCP tools with specialized renderers retain those renderers. Unknown tools without renderers receive a compact fallback with full stored text and arguments on expansion.
- Native expansion controls, click handling, and inline images are owned by pi. No executable tools, schemas, results, or model-facing content are replaced.

Renderer state is scoped to each call; there are no timers or background processes. Switching themes, streaming, parallel calls, and resumed sessions are supported.

## Matching composer, footer, and browser

The companion packages in this workspace own their respective UI surfaces:

- [Prompt Truly Mine](../prompt-truly-mine/README.md): matching user-message surface and text colors, without horizontal rules, leading glyphs, side rails, or added content indentation.
- [Compact Status Bar](../status-bar/README.md): balanced metadata with context and extension-status priority on narrow terminals.
- [Tool Output Browser](../tool-output-browser/README.md): open-sided, lightly framed output panels.

Obsidian UI does not compete for their editor/footer factories. Each companion also works with other pi themes.

## Compatibility

Tool presentation is tested against **pi 1.2.0**. Older runtimes without `registerToolRenderer` receive a TUI warning instead of replacement tool registrations. The theme can be selected separately if the runtime supports its schema. We do not claim full compatibility with older pi versions.

Tests use Node 24's experimental TypeScript transform because the existing editor/browser implementations use constructor parameter properties. No compiler or additional runtime dependency is required when pi loads these sources.

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-obsidian-ui
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/obsidian-ui` or expose it through the workspace's development symlink. A plain extension-directory symlink does not expose nested theme files: link `themes/obsidian-ice.json` into `~/.pi/agent/themes/obsidian-ice.json` separately, then select it in `/settings`. Do not create the extra theme link when package discovery already exposes the theme. Run `/reload` after source changes.

## Backout

Select your previous theme (for example `dark`) in `/settings`, disable this extension through `pi config`, and reload. For a linked development installation, remove only the theme-file symlink you created if it is no longer needed. Companion chrome changes are independent; revert their presentation changes separately to restore their old appearance. No session migration is needed.
