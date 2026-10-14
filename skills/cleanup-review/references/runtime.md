# Session and website

Use Python 3.10 or newer, Node.js 24 or newer, npm, Git, and macOS `lsof`. The executor targets the user's macOS `~/.Trash`. Do not assume another platform has the same Trash behavior.

Set `skill_dir` to this skill folder. Choose a fresh `session_dir` below the user's home and outside cleanup candidates. These variables are examples, not fixed locations.

```sh
python3 "$skill_dir/scripts/cleanup.py" init "$session_dir"
```

This copies the website, bridge, lockfile, and executor. It creates a session ID and private review files. Each session has its own browser storage keys and connection tokens. Keep the folder private. Do not commit its contents to a repository.

## Supply reviewed evidence

Write a JSON file with `items` and optional `batches`. This is an agent-curated file, not raw scanner output. A minimal repository card looks like this:

```json
{
  "items": [
    {
      "id": "example-project-v1",
      "kind": "repo",
      "title": "Example project dependencies",
      "paths": ["~/Projects/example"],
      "bytes": 950000000,
      "why": "You no longer build this project locally. Its installed packages account for most of its size.",
      "check": "Retain the source. Confirm the lockfile and registry can restore the packages.",
      "dependencies": {
        "paths": ["~/Projects/example/node_modules"],
        "bytes": 900000000
      },
      "pathEvidence": [{ "path": "~/Projects/example", "bytes": 950000000 }]
    }
  ],
  "batches": [{ "id": "first-pass", "name": "First pass", "ids": ["example-project-v1"] }]
}
```

Use measured facts in actual cards. Optional display fields include `branch`, `last_commit`, `flags`, and `ignored`. Keep secrets out of these fields. `verification` contains execution evidence described in [execution.md](execution.md). Dependencies can also be standalone cards whose `paths` contain only `node_modules` directories.

```sh
python3 "$skill_dir/scripts/cleanup.py" render "$session_dir" --input "$curated_json"
```

Rendering retains old item definitions for saved decisions and refuses to change an existing ID's target scope. New batch files may include only the new cards. Restart the bridge after changing review data, then reload the page. Do not restart it while delivery or execution is in progress.

## Connect Codex

Use the current conversation's known thread ID. Do not guess it or attach to an unrelated thread. The local Codex app-server socket must support the methods used by the included bridge. The default socket is `~/.codex/app-server-control/app-server-control.sock`; override it if the app provides a different path.

```sh
python3 "$skill_dir/scripts/cleanup.py" serve "$session_dir" \
  --host codex --thread "$current_thread_id"
```

The bridge initializes the app-server connection, resumes that exact thread, starts or steers user messages, and streams assistant text back. It forwards no reasoning or tool output. Tool permission requests remain in the main app. If the socket or protocol is unavailable, report the connection failure. Do not pretend messages were delivered.

## Connect Pi

Load the bundled extension explicitly when starting Pi:

```sh
pi -e "$skill_dir/assets/pi-bridge.ts"
```

Start the website bridge in another terminal or a managed background process:

```sh
python3 "$skill_dir/scripts/cleanup.py" serve "$session_dir" --host pi
```

In the intended Pi conversation, run `/cleanup-connect /absolute/path/to/session`. The extension binds the review to that Pi session. It submits page text through `pi.sendUserMessage`, queues it as a follow-up while the agent is busy, and streams assistant text events. It disconnects on session shutdown or replacement. `/cleanup-disconnect` detaches it manually. A review bound to another conversation needs a fresh session, not a changed session ID in its state file.

## Open and operate the page

`serve` installs the locked `ws` dependency with scripts disabled, binds to loopback, and prints the private review URL. Keep the server running and open that URL in the user's browser. `bridge-connection.js` also holds the URL. The page displays connection status, saved choices, notes, and the latest execution progress. Keep its token out of shared logs or screenshots.

Use a managed background process if the user needs to review while the agent continues. The server writes its PID under `bridge/state/server.pid`. Verify the process command before stopping it. Send SIGTERM to that process; do not kill unrelated Node processes.

The HTTP server exposes only listed website assets. Browser and Pi agent sockets use different tokens. An unconnected page can save choices and drafts, but cannot submit approval or claim that chat delivery succeeded.

## Session records

- `session.json` identifies the session and home directory.
- `review-data.json` holds curated item definitions.
- `review-state.json` holds choices and per-item notes.
- `approvals/ID.json` records the exact approved paths, choices, notes, and evidence.
- `trash-move-*.json` records checks, moves, verification, and failures with `approvalId`.
- `restore-ID.txt` and the Trash batch's `RESTORE.txt` contain recovery commands.
- `bridge/state/` holds private connection settings, delivery receipts, and recent messages.

Use `scripts/test.sh` to test fixtures without opening or changing the user's review page. Its Codex test uses a simulated app-server. Its Pi test loads the actual extension against a simulated Pi host and a real local WebSocket server.
