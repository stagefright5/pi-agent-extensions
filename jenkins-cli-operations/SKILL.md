---
name: jenkins-cli-operations
description: Configure and use the official Jenkins CLI safely across Windows, Ubuntu/Linux, and macOS. Use for Jenkins authentication setup, job and folder discovery, parameter inspection, build triggering with explicit confirmation, build monitoring, console output, and troubleshooting CLI transport or permissions.
compatibility: Requires Node.js 18+, Java compatible with the Jenkins controller, network access to Jenkins, and either jenkins-cli on PATH or a downloaded jenkins-cli.jar.
---

# Jenkins CLI Operations

Use the bundled scripts to avoid putting API tokens directly in commands, chat, shell history, or repository files.

## Non-negotiable safety rules

1. Never ask a user to paste an API token into chat. Direct them to a protected auth file, environment variables, or a native credential store.
2. Never print tokens, auth-file contents, Authorization headers, cookies, or secret build-parameter values.
3. Read-only commands may run without confirmation.
4. Before triggering a build, show the exact job, non-secret parameters, redacted sensitive parameters, wait/follow behavior, and expected side effects. Obtain explicit user confirmation.
5. Run `trigger-build.mjs --yes` only after that confirmation. Without `--yes`, the script itself requires interactive confirmation.
6. Do not stop, cancel, disable, delete, or reconfigure jobs unless the user explicitly requests that separate mutation and confirms it.
7. Avoid passing secrets through ordinary Jenkins String/Text parameters. They are commonly retained in build metadata. Prefer Jenkins credential bindings or Password parameters.
8. Never use `-noCertificateCheck` as a routine workaround. Resolve trust/certificate configuration instead.

## Locate the skill

Set `SKILL_DIR` to this skill directory before using scripts:

```bash
SKILL_DIR=/path/to/jenkins-cli-operations
```

On PowerShell:

```powershell
$SkillDir = 'C:\path\to\jenkins-cli-operations'
```

## Workflow

### 1. Establish intent

Determine:

- Jenkins base URL;
- whether the task is read-only or triggers a build;
- exact job/folder if known;
- desired build parameters;
- whether to wait and stream output.

Do not collect the token in conversation.

### 2. Configure authentication

Read [Authentication](references/AUTHENTICATION.md) for OS-specific file and native credential-store setup.

Create the non-secret configuration with `configure.mjs`:

```bash
node "$SKILL_DIR/scripts/configure.mjs" \
  --url https://jenkins.example.com \
  --auth-provider file \
  --auth-file ~/.config/jenkins/cli-auth
```

For a downloaded jar, add `--jar /path/to/jenkins-cli.jar`. For a launcher already on `PATH`, add `--command jenkins-cli`.

Configuration defaults:

- Windows: `%APPDATA%\jenkins-cli-operations\config.json`
- Linux/macOS: `${XDG_CONFIG_HOME:-~/.config}/jenkins-cli-operations/config.json`
- Override: `JENKINS_SKILL_CONFIG` or `--config <path>`

### 3. Verify access

```bash
node "$SKILL_DIR/scripts/jenkins.mjs" -- who-am-i
node "$SKILL_DIR/scripts/jenkins.mjs" -- help
```

The wrapper defaults to WebSocket transport. If the reverse proxy does not support it, configure `--transport http` and retry. An HTTP 401 means the Jenkins user ID/token pair is invalid; do not bypass it.

### 4. Discover jobs

Root jobs:

```bash
node "$SKILL_DIR/scripts/jenkins.mjs" -- list-jobs
```

Folder contents:

```bash
node "$SKILL_DIR/scripts/jenkins.mjs" -- list-jobs 'Folder Name'
```

Large controllers may return thousands of jobs. Filter locally and avoid dumping an unbounded list into chat:

```bash
node "$SKILL_DIR/scripts/jenkins.mjs" -- list-jobs | grep -i 'search-term'
```

Use PowerShell `Select-String` on Windows.

### 5. Inspect the selected job

Always inspect parameter names and types before preparing a build:

```bash
node "$SKILL_DIR/scripts/inspect-job.mjs" --job 'Folder/Job Name'
```

This is read-only and supports nested folders and multibranch job paths.

### 6. Prepare and confirm a build

Prefer a mode-restricted JSON parameter file over long shell arguments:

```json
{
  "BRANCH": "main",
  "SUITES": "api-specs"
}
```

Show the user a summary, redacting names containing `password`, `secret`, `token`, `credential`, `private`, `key`, or `auth`. Explain that build parameters and the build itself are server-side mutations.

After explicit confirmation:

```bash
node "$SKILL_DIR/scripts/trigger-build.mjs" \
  --job 'Folder/Job Name' \
  --params-file /secure/path/params.json \
  --follow \
  --verbose \
  --yes
```

For a small non-secret parameter set:

```bash
node "$SKILL_DIR/scripts/trigger-build.mjs" \
  --job 'Folder/Job Name' \
  --param BRANCH=main \
  --param RUN_TESTS=true \
  --follow \
  --yes
```

Without `--follow`, the command queues the build and returns. With `--follow`, it propagates the final Jenkins result as its exit status. `--verbose` streams console output.

### 7. Report the outcome

Return:

- exact job and build number;
- Jenkins build URL;
- final status;
- relevant test/build summary;
- artifact/report URLs when available;
- warnings that did not affect the final result.

Do not copy secrets or complete environment payloads from console output or build parameters.

## Direct CLI escape hatch

Use the authenticated wrapper for Jenkins commands not covered by helpers:

```bash
node "$SKILL_DIR/scripts/jenkins.mjs" -- help <command>
node "$SKILL_DIR/scripts/jenkins.mjs" -- console 'Folder/Job' 123
```

Mutating commands still require explicit confirmation under the safety rules above.

## References

- [Authentication and installation](references/AUTHENTICATION.md)
- [Operational recipes and troubleshooting](references/OPERATIONS.md)
