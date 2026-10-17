---
"@stagefright5/pi-prompt-truly-mine": minor
"@stagefright5/pi-status-bar": minor
---

Fold the status line into the composer footer. Compact Status Bar now lends its line through a shared global key, and the focused Prompt Truly Mine composer draws it in its footer bar (after the mode label, with undo/redo hints or the overflow indicator in the middle gap), so Pi's separate footer row disappears. Whenever the composer is unfocused or cannot draw it, the status bar shows its own row again. The footer bar loses its bottom half-row padding, the `Ask Pi anything` placeholder is gone, and input hints (`/ commands  $ skills  ! shell  @ files`) now show right-aligned in the empty draft row.
