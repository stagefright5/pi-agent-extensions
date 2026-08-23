# Operational recipes and troubleshooting

Paths in this reference are relative to the directory containing `SKILL.md`. Resolve script paths before execution rather than assuming the current working directory.

## Read-only commands

```bash
node scripts/jenkins.mjs -- who-am-i
node scripts/jenkins.mjs -- help
node scripts/jenkins.mjs -- help build
node scripts/jenkins.mjs -- list-jobs
node scripts/jenkins.mjs -- list-jobs 'Folder Name'
node scripts/inspect-job.mjs --job 'Folder/Job Name'
node scripts/inspect-job.mjs --job 'Folder/Job Name' --json
node scripts/jenkins.mjs -- console 'Folder/Job Name' 123
```

Job names use Jenkins full names with `/` between folders. Discover multibranch names rather than guessing their encoding.

Large controllers may return thousands of root jobs. Filter output locally:

```bash
node scripts/jenkins.mjs -- list-jobs | grep -i 'search-term'
```

Use `Select-String` instead of `grep` in PowerShell.

## Prepare a build without queueing it

Use `--dry-run` with the exact execution options intended for the real build:

```bash
node scripts/trigger-build.mjs \
  --job 'Folder/Job' \
  --param BRANCH=main \
  --follow \
  --dry-run
```

The helper contacts Jenkins, confirms that the job is buildable, validates declared parameter names, prints a build summary, and exits before confirmation or CLI execution. `--yes` has no effect when `--dry-run` is present.

## Trigger modes

Queue and return:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --param BRANCH=main --yes
```

Follow the final result without streaming console output:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --param BRANCH=main --follow --yes
```

Follow and stream console output:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --params-file params.json --follow --verbose --yes
```

`--verbose` requires `--follow`. Follow mode uses Jenkins CLI `build -f`; interrupting the local process does not abort the server-side build. The final local exit status reflects the Jenkins result unless the local process itself is interrupted.

## Confirmation summary

Before passing `--yes`, show and confirm:

- controller URL;
- exact full job name;
- whether the job is buildable or already queued;
- submitted parameters and defaults-only behavior;
- queue-only, follow, and console-streaming behavior;
- known or unknown deployments, notifications, test data, infrastructure changes, and cost.

Use a fresh confirmation after presenting the dry-run summary.

## Parameter files

A parameter file is a JSON object with scalar values:

```json
{
  "CHECKOUT_BRANCH": "main",
  "RUN_TESTS": true,
  "RETRY_COUNT": 0
}
```

On Linux/macOS, restrict a parameter file containing internal values:

```bash
chmod 600 params.json
```

PowerShell ACL example:

```powershell
icacls .\params.json /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
```

Command-line `--param NAME=VALUE` entries override matching values loaded from the file.

## Direct CLI pass-through

The wrapper accepts any command supported by the installed official Jenkins CLI:

```bash
node scripts/jenkins.mjs -- help <command>
node scripts/jenkins.mjs -- <command> [arguments...]
```

The wrapper deliberately does not classify or block mutating commands. Determine command semantics first with `help <command>`, and obtain confirmation before mutations.

## Finding a build URL

Use the URL printed by Jenkins or returned by its API. A nested job URL generally resembles:

```text
<JENKINS_URL>/job/<folder>/job/<job>/<build-number>/
```

Do not construct it manually when names contain spaces, encoded characters, or slashes.

## Transport failures

### WebSocket handshake failure

A reverse proxy may not support the WebSocket upgrade. Reconfigure with `--transport http` and retry.

### HTTP transport failure

Switch back to `webSocket`. Some controller or proxy combinations reject the duplex HTTP CLI endpoint while WebSocket works.

### HTTP 401

- Verify that the API token has not expired or been revoked.
- Verify the Jenkins user ID; it may differ from an email address or display name.
- Verify that the token belongs to that exact user ID.
- Rerun `who-am-i` after correcting the provider.

### HTTP 403

Authentication may have succeeded while the identity lacks `Overall/Read`, `Job/Read`, or `Job/Build`. Request the minimum required permissions from a Jenkins administrator.

### Job not found

- Run `list-jobs` at root or within the containing folder.
- Use the full Jenkins job name, not only its display name.
- Check case, spaces, and multibranch encoding.

### Unknown parameter

Run `inspect-job.mjs` again. Parameter definitions may change when a Pipeline job refreshes its Jenkinsfile.

## Native credential-store failures

### macOS

```bash
security find-generic-password -s 'jenkins-cli:jenkins.example.com' -a 'USER_ID' -w >/dev/null
```

### Linux

```bash
secret-tool lookup service 'jenkins-cli:jenkins.example.com' account 'USER_ID' >/dev/null
```

A headless server may not have an unlocked Secret Service session. Use a protected auth file or environment injection instead.

### Windows

```powershell
Import-Module CredentialManager
Get-StoredCredential -Target 'jenkins-cli:jenkins.example.com' | Select-Object UserName
```

If the module is unavailable, use a protected auth file or environment injection.

## Result interpretation

- `SUCCESS`: completed successfully.
- `UNSTABLE`: completed with unstable quality, test, or reporting conditions.
- `FAILURE`: the Pipeline failed.
- `ABORTED`: Jenkins stopped the build.
- Local exit `125` in follow mode: the local follow was interrupted; the server-side build may still be running.

Separate test or build failures from post-processing warnings when reporting the result.
