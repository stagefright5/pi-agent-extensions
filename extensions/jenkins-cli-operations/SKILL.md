---
name: jenkins-cli-operations
description: Configure and operate Jenkins through the official CLI. Use for authentication setup, job and folder discovery, parameter inspection, build preparation and triggering, build monitoring, console output, and CLI transport or permission troubleshooting.
compatibility: Requires Node.js 18+, Java compatible with the Jenkins controller, network access to Jenkins, and either jenkins-cli on PATH or a downloaded jenkins-cli.jar.
---

# Jenkins CLI Operations

Use the bundled scripts for repeatable Jenkins CLI configuration, authentication, job inspection, and build execution.

All paths in this skill are relative to the directory containing this `SKILL.md`. Resolve them to absolute paths before invoking tools; never assume the current working directory is the skill directory.

## Core rules

1. Never ask the user to paste an API token into chat. Never print credentials, auth-file contents, Authorization headers, or cookies.
2. Read-only operations may run without confirmation.
3. Before any Jenkins mutation, show the controller, exact job or command, parameters, execution behavior, and known or unknown side effects. Obtain fresh explicit confirmation after showing that summary.
4. Pass `--yes` to a mutating helper only after that confirmation. An initial request establishes intent but does not replace the post-summary confirmation.
5. Do not weaken TLS verification with `-noCertificateCheck`; fix certificate trust or proxy configuration instead.

## Workflow

### 1. Establish the operation

Determine the requested controller, operation, full job or folder name, build parameters, and whether build execution should return after queueing, follow completion, or stream console output. Ask only for details that cannot be discovered from existing configuration or Jenkins.

### 2. Reuse or create configuration

Check the configured path before asking setup questions:

- Windows: `%APPDATA%\jenkins-cli-operations\config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/jenkins-cli-operations/config.json`, or `~/.config/jenkins-cli-operations/config.json` when `XDG_CONFIG_HOME` is unset
- Override: `JENKINS_SKILL_CONFIG` or `--config PATH`

If configuration exists, do not recreate it. Verify access:

```bash
node scripts/jenkins.mjs -- who-am-i
```

If configuration is absent or invalid, follow [Authentication and installation](references/AUTHENTICATION.md). Do not inspect or display credential-file contents.

### 3. Perform read-only discovery

Use bounded discovery rather than dumping a large controller:

```bash
node scripts/jenkins.mjs -- list-jobs
node scripts/jenkins.mjs -- list-jobs 'Folder Name'
node scripts/inspect-job.mjs --job 'Folder/Job Name'
```

Filter large job lists locally. Always inspect a job before preparing a parameterized build.

### 4. Prepare a build

Run the intended build command with `--dry-run`. This performs live job inspection and parameter validation, prints the execution summary, and exits without queueing a build:

```bash
node scripts/trigger-build.mjs \
  --job 'Folder/Job Name' \
  --param BRANCH=main \
  --param RUN_TESTS=true \
  --follow \
  --dry-run
```

For a larger parameter set, use `--params-file PATH` with a JSON object. The dry-run must use the same job, parameters, and follow/verbose options intended for execution.

### 5. Confirm and execute

Present the dry-run summary to the user, including:

- Jenkins controller and full job name;
- submitted parameters and defaults-only behavior;
- queue-only, follow, and console-streaming behavior;
- known or unknown deployment, notification, test-data, infrastructure, or cost effects.

After fresh explicit confirmation, rerun the same command without `--dry-run` and with `--yes`:

```bash
node scripts/trigger-build.mjs \
  --job 'Folder/Job Name' \
  --param BRANCH=main \
  --param RUN_TESTS=true \
  --follow \
  --yes
```

Without `--yes`, the helper requires an interactive typed confirmation. Interrupting a followed CLI process does not necessarily stop the server-side build.

### 6. Report the outcome

Report the exact job, build number and URL when available, final status, relevant test/build summary, artifact or report URLs, and non-fatal warnings. Distinguish the Jenkins result from local follow interruption.

## Direct CLI commands

The authenticated wrapper intentionally passes through any official Jenkins CLI command:

```bash
node scripts/jenkins.mjs -- help <command>
node scripts/jenkins.mjs -- console 'Folder/Job' 123
```

Determine whether a command mutates Jenkins before running it. Apply the same summary and confirmation rule to every mutating direct command; the wrapper itself does not classify or restrict commands.

## References

- [Authentication and installation](references/AUTHENTICATION.md)
- [Operational recipes and troubleshooting](references/OPERATIONS.md)
