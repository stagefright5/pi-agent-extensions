---
"@stagefright5/pi-jenkins-cli-operations": minor
---

Add `artifacts` and `download` commands for build artifacts. `artifacts JOB [BUILD]` lists archived files (defaulting to `lastSuccessfulBuild`); `download JOB BUILD --out DIR` fetches `--all` or selected `--artifact` paths with the profile credential resolved in-process. Destinations are validated against path escapes and symlinks, existing files are kept unless `--force`, writes are atomic with a size check, and redirects outside the controller origin fail instead of leaking credentials.
