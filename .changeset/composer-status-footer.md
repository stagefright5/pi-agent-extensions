---
"@stagefright5/pi-prompt-truly-mine": minor
"@stagefright5/pi-status-bar": minor
---

Fold the status line into the composer footer. Compact Status Bar now lends its line through a shared global key, and the focused Prompt Truly Mine composer draws it in a single-row footer bar as `<dir · branch>  <mode>  <hints> · <statuses> … model · context · cost`, so Pi's separate footer row disappears. Whenever the composer is unfocused or cannot draw it, the status bar shows its own row again. The draft bar keeps its half-row padding and ends on the terminal background above the one-row footer, footer text uses lower contrast against its bar, the `Ask Pi anything` placeholder is gone, and input hints (`/ commands  $ skills  ! shell  @ files`) show right-aligned in the empty draft row.
