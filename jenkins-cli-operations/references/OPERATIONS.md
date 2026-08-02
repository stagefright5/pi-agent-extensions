# Operational recipes and troubleshooting

## Read-only commands

```bash
node scripts/jenkins.mjs -- who-am-i
node scripts/jenkins.mjs -- help
node scripts/jenkins.mjs -- help build
node scripts/jenkins.mjs -- list-jobs
node scripts/jenkins.mjs -- list-jobs 'Folder Name'
node scripts/inspect-job.mjs --job 'Folder/Job Name'
node scripts/jenkins.mjs -- console 'Folder/Job Name' 123
```

Job names use Jenkins full names with `/` between folders. Multibranch branch names may appear URL-encoded in the job name; discover them rather than guessing.

## Trigger modes

Queue and return:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --param BRANCH=main --yes
```

Follow result without console streaming:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --param BRANCH=main --follow --yes
```

Follow and stream console:

```bash
node scripts/trigger-build.mjs --job 'Folder/Job' --params-file params.json --follow --verbose --yes
```

`--follow` uses Jenkins CLI `build -f`, so interrupting the local command does not abort the server-side build. The final process exit code reflects the Jenkins result.

## Confirmation checklist

Before passing `--yes`, confirm:

- exact controller URL;
- exact full job name;
- job is buildable and whether it is already queued;
- branch/ref and all non-default parameters;
- sensitive values are redacted;
- no secret is being put in a String/Text parameter;
- whether the command returns after queueing or follows to completion;
- expected environmental side effects, test data, deployments, notifications, and cost.

## Parameter files

Use JSON with scalar values:

```json
{
  "CHECKOUT_BRANCH": "main",
  "RUN_TESTS": true,
  "RETRY_COUNT": 0
}
```

Restrict files containing internal values:

```bash
chmod 600 params.json
```

PowerShell ACL example:

```powershell
icacls .\params.json /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
```

Do not use a parameter file to legitimize secret-bearing String/Text parameters. Jenkins still retains submitted build parameters server-side.

## Finding a build URL

The CLI prints the build number when Jenkins starts it. The URL is generally:

```text
<JENKINS_URL>/job/<folder>/job/<job>/<build-number>/
```

Use the URL printed by Jenkins or the job API rather than constructing it when names contain spaces or slashes.

## Transport failures

### WebSocket handshake fails

A reverse proxy may not support the WebSocket upgrade. Reconfigure:

```bash
node scripts/configure.mjs ... --transport http
```

### HTTP mode fails but WebSocket works

Use `webSocket`. Some proxy/controller combinations reject the duplex HTTP CLI endpoint even while REST and WebSocket authentication work.

### HTTP 401

- Verify the API token has not expired or been revoked.
- Verify the Jenkins user ID, which may be an SSO object ID rather than email/display name.
- Verify the token belongs to that exact user ID.
- Run `who-am-i` after correction.

Do not add `-noCertificateCheck` or weaken TLS to solve authentication.

### HTTP 403

Authentication may have succeeded but the identity lacks `Overall/Read`, `Job/Read`, or `Job/Build`. Ask a Jenkins administrator for least-privilege access.

### Job not found

- Run `list-jobs` at root or inside the containing folder.
- Use the full Jenkins job name, not only the display name.
- Check case, spaces, and multibranch encoding.

### Unknown parameter

Run `inspect-job.mjs` again. Parameter definitions can change when a Pipeline job refreshes its Jenkinsfile.

## Native credential-store failures

### macOS

```bash
security find-generic-password -s 'jenkins-cli:jenkins.example.com' -a 'USER_ID' -w >/dev/null
```

### Ubuntu/Linux

```bash
secret-tool lookup service 'jenkins-cli:jenkins.example.com' account 'USER_ID' >/dev/null
```

Headless servers may not have an unlocked Secret Service session. Use a protected file or a secret-manager-injected environment instead.

### Windows

```powershell
Import-Module CredentialManager
Get-StoredCredential -Target 'jenkins-cli:jenkins.example.com' | Select-Object UserName
```

If the module is unavailable, use a protected file or environment injection.

## Result interpretation

- `SUCCESS`: job completed successfully.
- `UNSTABLE`: job completed but one or more quality/test/reporting conditions were unstable.
- `FAILURE`: pipeline failed.
- `ABORTED`: pipeline or build was stopped.
- CLI exit `125` with follow mode: local follow was interrupted; the server build may still be running.

Separate test failures from post-processing warnings. For example, tests can pass while artifact publication or email notification makes the overall job unstable.
