# Changelog

## 0.2.0

### Minor changes

- Introduce the Obsidian Ice theme and presentation-only compact tool renderers for pi 1.2. Style the existing composer through border-only hooks without adding content prefixes, balance the footer with context/status priority, and give the output browser open-sided panels. Preserve native edit/shell/specialized rendering and add Unicode, width, cursor, autocomplete, streaming/error, theme, and navigation regression tests.

### Patch changes

- Separate composer shortcut/shell/overflow text from decorative border colors. Raise secondary-text, meaningful-border, and scrollbar contrast; explicitly color the browser selection marker. Use neutral selection/search/track surfaces to preserve contrast after 256-color quantization. Test emitted ANSI foreground/background pairs against 4.5:1 text and 3:1 non-text targets, with opaque-background limitations documented.
