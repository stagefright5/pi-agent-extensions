# @stagefright5/pi-jenkins-cli-operations

## 0.3.0

### Minor Changes

- 0f96e4f: Add `artifacts` and `download` commands for build artifacts. `artifacts JOB [BUILD]` lists archived files (defaulting to `lastSuccessfulBuild`); `download JOB BUILD --out DIR` fetches `--all` or selected `--artifact` paths with the profile credential resolved in-process. Destinations are validated against path escapes and symlinks, existing files are kept unless `--force`, writes are atomic with a size check, and redirects outside the controller origin fail instead of leaking credentials.

## 0.2.0

### Minor changes

- a24723a: Add named profiles for multiple Jenkins credentials and controllers. Provide one command interface for profile setup, discovery, job inspection, builds, and console output. Preserve existing single-connection configs and script invocations, shorten the skill workflow, and test profile selection and migration without a live controller.

### Added

- Support named profiles for multiple accounts on the same controller or connections to different controllers. Each profile has its own URL, launcher, transport, and credential-provider reference.
- Accept `--profile NAME` across all helpers. Selection uses the explicit option, then `JENKINS_SKILL_PROFILE`, then the configured default, then a sole profile. Unknown or ambiguous selections fail without trying another credential.
- Add `profiles`, `configure`, `whoami`, `jobs`, `inspect`, `build`, and `console` commands to `scripts/jenkins.mjs`. Keep upstream commands available through `cli -- COMMAND`.
- List profile metadata with `profiles --json` without accessing credential stores. Include the configured default and environment selection.
- Add `--default` for default-profile selection and require `--replace` to overwrite an existing named profile. Preserve other profiles, lock concurrent writes, and replace configuration files atomically.
- Include the selected profile and controller in job inspection output. Include the profile and authentication provider in build summaries.
- Add tests for selection precedence, credential isolation, migration, configuration writes, CLI compatibility, build execution through a fake CLI, and temporary credential cleanup. All 19 tests pass without a live Jenkins controller.

### Changed

- Route routine operations through one script and shorten the skill instructions. A build dry-run already inspects the job, so a separate inspection is needed only to discover parameters.
- Document credential setup, profile selection, migration, rollback, and troubleshooting. Keep tokens out of config files and preserve the dry-run and explicit confirmation policy for Jenkins mutations.
- Reject URLs containing credentials, queries, or fragments. Continue to require HTTPS except for local controllers.
- Reject unknown convenience commands rather than forwarding them to Jenkins.

### Compatibility

- Existing single-connection configs work unchanged as profile `default`. Read-only commands do not rewrite them. Adding a named profile preserves the old connection and its default selection in the new version-2 config.
- Existing standalone scripts and `jenkins.mjs -- COMMAND` syntax still work. Wrapper options stop at `--`, so upstream arguments remain intact.
- Older helpers cannot read version-2 profile configs. Restore the previous config or extract one connection into a legacy config to roll back.
- Advanced and legacy CLI pass-through still accept arbitrary commands. The skill requires confirmation before mutations, but the wrapper does not enforce it.

## 0.1.2

### Patch changes

- 20125b0: Generate package licenses and publication metadata from shared workspace defaults. Publish staged runtime-only packages with generated installation instructions and repository links, while preserving build-free source development. Keep package catalogues and Pi resource indexes synchronized and validate published tarball contents.

## 0.1.1

### Patch changes

- b54d008: Rewrite the README, SKILL.md, and reference docs in plain language: sentence-case headings, shorter sentences, active voice, and no em dashes or filler. Skill instructions keep the same steps and rules.
