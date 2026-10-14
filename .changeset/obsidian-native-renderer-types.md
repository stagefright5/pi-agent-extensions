---
"@stagefright5/pi-obsidian-ui": patch
---

Fix pi 1.2.0 SDK type compatibility by treating native renderer callbacks as opaque identities when comparing them, rather than requiring incompatible callable renderer signatures. Preserve existing renderer selection and custom-renderer behavior without unsafe API casts.
