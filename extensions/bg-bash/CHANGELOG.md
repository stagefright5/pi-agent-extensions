# @stagefright5/pi-bg-bash

## 0.1.0

### Added

- Run bash commands in the foreground for a fixed 10 seconds, then let them continue as background jobs. Quick commands retain the built-in bash behavior.
- Add `job_status`, `job_output`, and `job_kill`. Keep `job_list` as an opt-in alias; `job_status` without an ID lists all jobs.
- Add completion messages, running/unread indicators, and a `/jobs` manager (`Alt+J`) with live previews, log browsing, copy, kill, and send-to-agent actions.
- Preserve jobs across `/reload`; stop them on quit or session changes. Use private logs and clean them up when jobs are reset.

### Fixed

- Remove the configurable `wait` argument and discard stale overrides. The optional `timeout` limits total runtime, including time spent in the background.
- Preserve output and truncation notices when a foreground command times out.
- Tell the agent to verify the exit code with `job_status` before reporting success. A background return is not a completion result.
