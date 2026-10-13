# Operational recipes and troubleshooting

Resolve `scripts/jenkins.mjs` relative to the directory containing `SKILL.md`. Use the same explicit profile for the whole operation.

## Read-only discovery

```bash
node scripts/jenkins.mjs profiles --json
node scripts/jenkins.mjs --profile reader whoami
node scripts/jenkins.mjs --profile reader jobs
node scripts/jenkins.mjs --profile reader jobs 'Folder Name'
node scripts/jenkins.mjs --profile reader inspect 'Folder/Job' --json
node scripts/jenkins.mjs --profile reader console 'Folder/Job' 123
node scripts/jenkins.mjs --profile reader cli -- help build
```

Job names are full names with `/` between folders. Discover multibranch names rather than guessing encoding. Filter large job lists locally, for example `... jobs | grep -i 'search-term'`. Use `Select-String` in PowerShell.

`profiles` lists names, URLs, provider types, configured keychain user IDs, the configured default, and the environment selection. It does not read credentials or probe Jenkins. Use `whoami` to verify the actual authenticated identity, especially for file/env providers.

## Prepare, confirm, execute

```bash
node scripts/jenkins.mjs --profile builder build 'Folder/Job' \
  --param BRANCH=main --follow --dry-run
```

This inspects the job and validates declared parameter names without queueing. A prior `inspect` is needed only when discovering parameters. `--yes` has no effect alongside `--dry-run`.

Before execution, present the selected profile, verified identity, controller, exact job, and execution mode. Show whether the job is buildable or queued. List submitted parameters with secrets redacted, or state that the build uses only defaults. Include known or unknown effects on deployments, notifications, test data, infrastructure, and cost. Obtain fresh explicit confirmation, then repeat with `--yes` instead of `--dry-run`:

```bash
node scripts/jenkins.mjs --profile builder build 'Folder/Job' \
  --param BRANCH=main --follow --yes
```

Without `--yes`, the helper requires an interactive typed confirmation and refuses non-interactive execution. The helper cannot verify that an agent actually obtained confirmation; this remains a skill policy.

| Options              | Behavior                                                  |
| -------------------- | --------------------------------------------------------- |
| None                 | Queue and return; not evidence of completed build success |
| `--follow`           | Follow the final Jenkins result                           |
| `--follow --verbose` | Follow and stream console output                          |

`--verbose` requires `--follow`. Follow uses Jenkins CLI `build -f`; interrupting the local process does not necessarily abort the server-side build. Never change the profile or its credential reference between preparation and execution; prepare and confirm again if anything changes.

## Parameter files

`--params-file PATH` takes a JSON object of string, number, or boolean values:

```json
{ "BRANCH": "main", "RUN_TESTS": true, "RETRY_COUNT": 0 }
```

Repeated `--param NAME=VALUE` entries override matching file values. Omitted parameters use Jenkins defaults. Protect files containing internal values with `chmod 600` on Linux/macOS or restricted ACLs on Windows. Do not place secrets directly in command-line arguments.

## Advanced CLI and compatibility

```bash
node scripts/jenkins.mjs --profile NAME cli -- help COMMAND
node scripts/jenkins.mjs --profile NAME cli -- COMMAND ARGUMENTS
```

Pass-through does not classify or block mutations. Check command behavior and obtain confirmation before mutations. The convenience interface rejects unknown commands instead of silently forwarding them. Wrapper options go before `--`; upstream options after it are preserved.

Legacy invocations still work, with optional `--profile NAME`:

```bash
node scripts/jenkins.mjs -- who-am-i
node scripts/inspect-job.mjs --job 'Folder/Job' --json
node scripts/trigger-build.mjs --job 'Folder/Job' --dry-run
node scripts/configure.mjs --help
```

All helpers support `--config PATH`. Existing single-connection files resolve as profile `default`; see [Authentication](AUTHENTICATION.md) for migration and rollback.

## Troubleshooting

- If a profile is unknown or ambiguous, run `profiles --json` and select the exact name. An invalid explicit or environment selection does not fall back to the default.
- If the WebSocket handshake fails, the proxy may not allow upgrades. With user agreement, replace that profile using all its existing settings and `--transport http --replace`. Preserve its credential reference and the other profiles.
- If HTTP transport fails, try WebSocket. Some proxies reject the duplex HTTP endpoint.
- For a 401, check the exact Jenkins user ID, token ownership, expiry or revocation, and the selected provider reference. Do not try other profiles automatically.
- For a 403, check whether the user has `Overall/Read`, `Job/Read`, and `Job/Build`. Request minimum permissions. Do not switch to a privileged identity without asking.
- If Jenkins cannot find a job, check its folder, case, spaces, multibranch encoding, and visibility under the selected identity.
- If a parameter is unknown, inspect again. Jenkinsfile refreshes can change definitions.
- If keychain access fails, verify the selected service label and account without displaying the token. On Linux, verify an unlocked Secret Service session. On Windows, verify that `CredentialManager` is available and each account has its own target label.
- If configuration is locked, verify no writer is active before removing a stale `.lock` file.

## Reporting results

Use build/report URLs returned by Jenkins, not guessed URLs for encoded names. Report `SUCCESS`, `UNSTABLE`, `FAILURE`, or `ABORTED` as returned. Separate local process interruption from Jenkins status; CLI follow may return 125 on interruption while the server-side build continues. Separate test/build failures from non-fatal post-processing warnings.
