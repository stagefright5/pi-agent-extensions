# Jenkins CLI Operations

Standalone Pi package for the bundled `jenkins-cli-operations` Agent Skill.

[Back to the extension workspace](../../README.md)

The npm package exposes `SKILL.md` directly through its Pi manifest. The colocated `index.ts` wrapper exposes the same skill when this source directory is loaded through Pi's extension auto-discovery. After `/reload` or restart, invoke it with:

```text
/skill:jenkins-cli-operations
```

## Contents

- `SKILL.md` — concise agent workflow and mutation-confirmation policy
- `references/AUTHENTICATION.md` — installation and credential-provider setup
- `references/OPERATIONS.md` — command recipes and troubleshooting
- `scripts/configure.mjs` — writes non-secret controller configuration
- `scripts/jenkins.mjs` — authenticated pass-through to the official Jenkins CLI
- `scripts/inspect-job.mjs` — read-only job and parameter inspection
- `scripts/trigger-build.mjs` — build dry-run, validation, confirmation, and execution

The generic wrapper intentionally supports every upstream Jenkins CLI command without classifying or restricting it. The skill instructs the agent to obtain confirmation before mutating Jenkins.

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
