---
"@stagefright5/pi-obsidian-ui": minor
---

Replace the fixed Obsidian Ice palette with `terminal-native`: composer, message, and tool-panel shades derived from the terminal's reported background, with ANSI palette text/status colors. Shades lift dark backgrounds or lower light backgrounds; success and failure share a neutral panel shade. Refresh on terminal appearance notifications, retain a flat terminal-default fallback when no background is reported, and clean up observers on reload/shutdown. This removes the blue/green/red panel fills retained by Pi's built-in `system` theme. Select `terminal-native` in Pi's settings. Source-linked installations should replace their old Obsidian theme symlink with one pointing to `themes/terminal-native.json`. Compact tool presentation continues to support other selected themes.
