# Jenkins CLI operations

Most of this package was written with the pi agent CLI.

This Pi package provides the `jenkins-cli-operations` Agent Skill: profile selection, safe discovery, build confirmation, and result reporting. The executable is distributed separately as [`@stagefright5/jenkins-cli`](../../packages/jenkins-cli/README.md), with the command name `jenkins`.

[Back to the extension workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-jenkins-cli-operations
```

<!-- package-tools:install:end -->

Install the supported CLI separately and make sure its npm global bin directory is on PATH:

```bash
npm install -g @stagefright5/jenkins-cli@0.1
jenkins --version
```

The version output must identify `@stagefright5/jenkins-cli` version `0.1.x`. Installing the skill does not automatically install or expose the CLI. Agents must not silently install or upgrade it. The CLI requires Node.js 18+, Jenkins network access, credentials, and Java plus the matching controller's official `jenkins-cli.jar` (or an upstream `jenkins-cli` launcher).

## Usage

After `/reload` or a restart:

```text
/skill:jenkins-cli-operations list jobs in Folder using the staging profile
```

The skill uses the public command from any working directory:

```bash
jenkins profiles --json
jenkins --profile staging whoami
jenkins --profile staging jobs 'Folder'
jenkins --profile staging inspect 'Folder/Job' --json
jenkins --profile staging build 'Folder/Job' --param BRANCH=main --follow --dry-run
```

Before any Jenkins mutation, the agent presents the profile, controller, job, parameters, mode, and known or unknown side effects, then obtains fresh explicit confirmation. Only then may it replace `--dry-run` with `--yes`. Raw `jenkins cli -- COMMAND` pass-through does not enforce mutation confirmation; the skill's safety rules still apply.

## Configuration and migration

Existing configuration paths, `JENKINS_SKILL_CONFIG`, `JENKINS_SKILL_PROFILE`, credential references, and single-connection configs remain supported. No credential migration is needed.

The skill no longer bundles `scripts/`. Update callers of `node /path/to/skill/scripts/jenkins.mjs` to `jenkins`; use `jenkins configure`, `jenkins inspect JOB`, and `jenkins build JOB` instead of the old standalone helpers.

- [Authentication](references/AUTHENTICATION.md) covers prerequisites, credentials, profiles, migration, and rollback.
- [Operations](references/OPERATIONS.md) covers command recipes and troubleshooting.
- [CLI README](../../packages/jenkins-cli/README.md) documents standalone installation and commands.

For source development, load this directory with `pi -e ./extensions/jenkins-cli-operations` or expose it through the workspace's development symlink. The `index.ts` wrapper exposes the colocated skill for auto-discovery; the npm package exposes it through its Pi manifest. Install the CLI separately as described in its README.

## Tests

Skill documentation checks:

```bash
node --test tests/*.test.mjs
```

Executable behavior and packaging are tested in `packages/jenkins-cli/` and the workspace packaging suite, without a live Jenkins controller.
