# Jenkins CLI operations

Most of this package was written with the pi agent CLI.

This standalone Pi package includes the `jenkins-cli-operations` Agent Skill.

[Back to the extension workspace](../../README.md)

The npm package exposes `SKILL.md` through its Pi manifest. The `index.ts` wrapper in this directory exposes the same skill when Pi's extension auto-discovery loads the directory. After `/reload` or a restart, invoke it with:

```text
/skill:jenkins-cli-operations
```

## Contents

- `SKILL.md` describes the agent workflow and mutation-confirmation policy.
- `references/AUTHENTICATION.md` covers installation and credential-provider setup.
- `references/OPERATIONS.md` contains command recipes and troubleshooting steps.
- `scripts/configure.mjs` writes non-secret controller configuration.
- `scripts/jenkins.mjs` authenticates and passes commands to the official Jenkins CLI.
- `scripts/inspect-job.mjs` inspects jobs and parameters without changing them.
- `scripts/trigger-build.mjs` handles build dry-runs, validation, confirmation, and execution.

The generic wrapper supports every upstream Jenkins CLI command without classifying or restricting it. The skill instructs the agent to obtain confirmation before mutating Jenkins.

## Requirements

- Node.js 18 or newer
- Java compatible with the Jenkins controller
- Official `jenkins-cli.jar` or a `jenkins-cli` launcher on `PATH`
- Jenkins network access and credentials

## Installation

Install the standalone package:

```bash
pi install npm:@stagefright5/pi-jenkins-cli-operations
```

For source development, load this directory with `pi -e ./extensions/jenkins-cli-operations` or expose it through the workspace's development symlink.

## Tests

The tests use Node's built-in test runner and do not require a live Jenkins controller:

```bash
node --test tests/*.test.mjs
```
