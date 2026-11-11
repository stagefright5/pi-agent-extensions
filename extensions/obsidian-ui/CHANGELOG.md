# Changelog

## 0.3.0

### Minor Changes

- 878f091: Replace the fixed Obsidian Ice palette with `terminal-native`: composer, message, and tool-panel shades derived from the terminal's reported background, with ANSI palette text/status colors. Shades lift dark backgrounds or lower light backgrounds; success and failure share a neutral panel shade. Refresh on terminal appearance notifications, retain a flat terminal-default fallback when no background is reported, and clean up observers on reload/shutdown. This removes the blue/green/red panel fills retained by Pi's built-in `system` theme. Select `terminal-native` in Pi's settings. Source-linked installations should replace their old Obsidian theme symlink with one pointing to `themes/terminal-native.json`. Compact tool presentation continues to support other selected themes.

## 0.2.1

### Fixed

- Compare native renderer callbacks by identity without incompatible callable signatures or unsafe API casts.
- Keep read-continuation and oversized-line recovery notices visible in collapsed output.
- Limit expanded native renderers to the viewport width and preserve tool backgrounds behind truncated labels.
- Use erasable TypeScript while retaining native and custom-renderer behavior.

### Changed

- Share composer and sent-message surface/text tokens while keeping tool calls visually distinct.
- Add contrast, theme-switching, and renderer regression coverage; shorten the documentation.

## 0.2.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.
