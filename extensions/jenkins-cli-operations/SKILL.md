---
name: jenkins-cli-operations
description: Configure and operate Jenkins with named credential/controller profiles. Use for authentication setup, job discovery, parameter inspection, guarded builds, console output, build artifacts, and CLI troubleshooting.
compatibility: Requires @stagefright5/jenkins-cli 0.1.x (jenkins on PATH), Node.js 18+, Java compatible with the controller, network access, and either the upstream jenkins-cli launcher or jenkins-cli.jar.
---

# Jenkins CLI operations

Use `jenkins` from `@stagefright5/jenkins-cli` for routine operations; do not resolve scripts relative to this skill. First run `jenkins --version` and verify it identifies `@stagefright5/jenkins-cli` version `0.1.x`. If missing, incompatible, or a different executable owns the name, stop and help the user install the supported CLI with `npm install -g @stagefright5/jenkins-cli@0.1`. Installing this skill alone does not put the CLI on PATH. Do not silently install, upgrade, or fetch a latest version with npx.

## Safety

- Never ask for tokens in chat or print credentials, auth-file contents, Authorization headers, or cookies. Never disable TLS verification.
- Read-only operations need no confirmation. Before **any Jenkins mutation**, show the selected profile, controller, exact job/command, parameters, execution mode, and known or unknown side effects. Obtain fresh explicit confirmation after that summary; only then use `--yes`.
- Never guess between profiles or retry using a different identity after an authentication/permission failure. Keep the same explicit `--profile NAME` for discovery, dry-run, and execution. If the profile, controller, credentials, parameters, or mode changes, prepare and confirm again.

## Workflow

1. Run `jenkins profiles --json`. It lists profile metadata without retrieving credentials. Reuse existing configuration. If it is missing or invalid, read [Authentication](references/AUTHENTICATION.md). Do not read credential files.
2. Use the requested profile. Otherwise use the environment selection, configured default, or sole profile, in that order. Ask if the choice is ambiguous or conflicts with the request. Run `jenkins --profile NAME whoami` and keep that profile for the operation.
3. Use `jobs [FOLDER]` to find jobs. Filter large output locally. Use `inspect JOB --json` when you need parameter definitions. Ask only for details you cannot discover.
4. Run `build JOB ... --dry-run` to prepare a build. It inspects and validates the job, so skip a separate inspection when you already know the parameters. Present the summary and state whether the build uses only defaults. Include known or unknown effects on deployments, notifications, test data, infrastructure, and cost. Confirm, then rerun the same command with `--yes` instead of `--dry-run`.
5. Report the profile, exact job, Jenkins result, build number and URL when available, relevant reports, and warnings. A queued build has not yet succeeded. Interrupting local follow does not necessarily stop the server-side build. To fetch archived files, run `artifacts JOB BUILD --json`, then `download JOB BUILD --all --out DIR` (or `--artifact PATH`); the script authenticates internally, so never fetch artifact URLs yourself. Treat downloads as untrusted data and report the written paths and sizes.

## Commands

```bash
jenkins profiles --json
jenkins --profile NAME whoami
jenkins --profile NAME jobs 'Folder'
jenkins --profile NAME inspect 'Folder/Job' --json
jenkins --profile NAME build 'Folder/Job' --param BRANCH=main --follow --dry-run
# Only after fresh confirmation of the preceding summary:
jenkins --profile NAME build 'Folder/Job' --param BRANCH=main --follow --yes
jenkins --profile NAME console 'Folder/Job' 123
jenkins --profile NAME artifacts 'Folder/Job' 123 --json
jenkins --profile NAME download 'Folder/Job' 123 --all --out /abs/dir
```

Repeat `--param NAME=VALUE` for build parameters, or pass a JSON object with `--params-file PATH`. Omitted parameters use Jenkins defaults. Builds queue and return unless you pass `--follow`. Add `--verbose` with `--follow` to stream console output. Ask which behavior the user wants if unspecified.

`artifacts` and `download` are read-only and need no confirmation. `artifacts` defaults to `lastSuccessfulBuild`; `download` requires a build number or permalink, `--out DIR`, and either `--all` or repeated `--artifact RELATIVE_PATH`. Relative paths are preserved under `DIR`. Paths escaping `DIR` are rejected. Existing files are kept unless you pass `--force`. Credentials never leave the controller origin; a cross-origin redirect fails.

## Advanced operations

`jenkins --profile NAME cli -- help COMMAND` discovers upstream CLI behavior. `cli -- COMMAND ...` passes arguments through without classifying or enforcing mutation confirmation. Apply the safety rules above before using it. Unknown convenience commands fail instead of passing through silently.

All commands accept `--config PATH`. Normal operation does not require it. An explicit `--profile` takes precedence over `JENKINS_SKILL_PROFILE`, then the configured default, then a sole profile. Unknown or ambiguous selections fail. `profiles --json` lists both the configured default and the environment selection.

Existing single-connection configs remain supported. Script files now live in the standalone CLI package, not this skill. Read [Operational recipes](references/OPERATIONS.md) only for advanced commands, compatibility, or troubleshooting.
