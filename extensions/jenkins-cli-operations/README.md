# Jenkins CLI operations

Most of this package was written with the pi agent CLI.

This standalone Pi package includes the `jenkins-cli-operations` Agent Skill.

[Back to the extension workspace](../../README.md)

The npm package exposes `SKILL.md` through its Pi manifest. The `index.ts` wrapper in this directory exposes the same skill when Pi's extension auto-discovery loads the directory. After `/reload` or a restart, invoke it with:

```text
/skill:jenkins-cli-operations
```

## Profiles and commands

Use named profiles for multiple accounts on one controller or for separate controllers. Each profile stores connection settings and a credential reference. Tokens stay in protected files, keychain entries, or environment variables.

All routine commands use `scripts/jenkins.mjs`:

```bash
node scripts/jenkins.mjs profiles --json
node scripts/jenkins.mjs --profile staging whoami
node scripts/jenkins.mjs --profile staging jobs 'Folder'
node scripts/jenkins.mjs --profile staging inspect 'Folder/Job' --json
node scripts/jenkins.mjs --profile staging build 'Folder/Job' --param BRANCH=main --follow --dry-run
```

Run these from the package directory or use the script's absolute path. In Pi, you can ask directly:

```text
/skill:jenkins-cli-operations list jobs in Folder using the staging profile
```

A build dry-run inspects the job and prints the execution summary without queueing it. After the user confirms that summary, replace `--dry-run` with `--yes` to execute.

Add a profile with a reference to an existing credential:

```bash
node scripts/jenkins.mjs configure --profile staging \
  --url https://staging.example.com \
  --jar /path/to/staging-jenkins-cli.jar \
  --auth-provider file --auth-file /path/to/staging-auth
```

Use `--default` to set the default profile. Use `--replace` with the full connection settings to replace an existing named profile. Other profiles remain unchanged.

An explicit `--profile` takes precedence over `JENKINS_SKILL_PROFILE`, then the configured default, then a sole profile. Unknown or ambiguous names fail. The helper never tries another credential after an authentication failure.

Existing single-connection configs work as profile `default`. Reads do not migrate them. Adding a named profile preserves the old connection and default selection. The older standalone scripts and `jenkins.mjs -- COMMAND` syntax still work.

## Files

- `SKILL.md` contains the agent workflow and confirmation rules.
- [Authentication](references/AUTHENTICATION.md) covers credential setup, profiles, migration, and rollback.
- [Operations](references/OPERATIONS.md) covers command recipes and troubleshooting.
- `scripts/jenkins.mjs` provides the command interface.
- `scripts/configure.mjs`, `scripts/inspect-job.mjs`, and `scripts/trigger-build.mjs` remain available for existing callers.

For advanced operations, `jenkins.mjs cli -- COMMAND` accepts any upstream Jenkins CLI command. It does not enforce mutation confirmation. The skill requires the agent to obtain confirmation before any Jenkins mutation.

## Requirements

- Node.js 18 or newer
- Java compatible with the Jenkins controller
- Official `jenkins-cli.jar` or a `jenkins-cli` launcher on `PATH`
- Jenkins network access and credentials

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-jenkins-cli-operations
```

<!-- package-tools:install:end -->

For source development, load this directory with `pi -e ./extensions/jenkins-cli-operations` or expose it through the workspace's development symlink.

## Tests

The tests use Node's built-in test runner and do not require a live Jenkins controller:

```bash
node --test tests/*.test.mjs
```
