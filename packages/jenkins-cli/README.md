# Jenkins CLI

A standalone Node.js CLI for Jenkins with named connection profiles, credential-provider references, build dry-runs, guarded execution, console output, and artifact downloads. No pi installation or runtime dependency is required.

- npm package: `@stagefright5/jenkins-cli`
- executable: `jenkins`

[Back to the workspace](../../README.md)

<!-- package-tools:install:start -->

## Installation

Install the standalone CLI:

```bash
npm install -g @stagefright5/jenkins-cli
```

<!-- package-tools:install:end -->

```bash
jenkins --version
jenkins --help
```

Ensure the npm global bin directory is on PATH. If another program already owns `jenkins`, resolve that conflict before using this CLI; do not force an overwrite. Version output identifies the package as well as its version.

## Requirements

- Node.js 18 or newer.
- Network access to Jenkins and a minimally privileged Jenkins user/API token.
- For upstream CLI operations, Java compatible with the controller and its official `jenkins-cli.jar`, or a `jenkins-cli` launcher on PATH.

This package does not bundle Java, a Jenkins JAR, credentials, or controller-specific configuration. Download the JAR from your controller's `/jnlpJars/jenkins-cli.jar` endpoint. The upstream `jenkins-cli` launcher is distinct from this package's `jenkins` command: never configure `--command jenkins`.

## Configure a profile

Create a protected credential file privately containing `USER_ID:API_TOKEN`; never paste tokens into chat, put them in command arguments, or commit them. On Unix, restrict the file to its owner with `chmod 600`.

```bash
jenkins configure --profile staging \
  --url https://staging.example.com \
  --jar /absolute/path/to/jenkins-cli.jar \
  --auth-provider file --auth-file /absolute/path/to/staging-auth \
  --default

jenkins profiles --json
jenkins --profile staging whoami
```

`configure --help` also describes environment-variable and native-keychain providers. Configuration stores credential references, not tokens. Replacing a profile requires `--replace`; other profiles are preserved. Configuration changes are local and do not contact Jenkins.

Selection order is `--profile NAME`, `JENKINS_SKILL_PROFILE`, configured default, then sole profile. Unknown or ambiguous profiles fail without trying another identity.

For compatibility with the original skill, configuration stays at:

- Windows: `%APPDATA%\jenkins-cli-operations\config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/jenkins-cli-operations/config.json` or `~/.config/jenkins-cli-operations/config.json`
- Override: `JENKINS_SKILL_CONFIG` or `--config PATH`

Existing single-connection configs and credential references work unchanged. See the [authentication guide](../../extensions/jenkins-cli-operations/references/AUTHENTICATION.md) for provider setup and migration details.

## Commands

```bash
jenkins --profile staging jobs 'Folder'
jenkins --profile staging inspect 'Folder/Job' --json
jenkins --profile staging build 'Folder/Job' --param BRANCH=main --follow --dry-run
# After reviewing the summary and confirming its effects:
jenkins --profile staging build 'Folder/Job' --param BRANCH=main --follow --yes
jenkins --profile staging console 'Folder/Job' 123
jenkins --profile staging artifacts 'Folder/Job' 123 --json
jenkins --profile staging download 'Folder/Job' 123 --all --out /absolute/output/dir
jenkins --profile staging cli -- help COMMAND
```

Repeat `--param NAME=VALUE` or use `--params-file PATH`. Without `--follow`, a build queues and returns; this is not evidence of success. `--follow --verbose` streams console output. Interrupting local follow does not necessarily stop the server-side build.

`build --dry-run` inspects and validates without queueing. Execution requires `--yes` or interactive typed confirmation. `--dry-run` takes precedence over `--yes`. Agents must present the summary and obtain fresh user confirmation before passing `--yes`; the executable cannot verify that conversation.

**Advanced pass-through is not guarded:** `jenkins cli -- COMMAND ...` and legacy `jenkins -- COMMAND ...` can invoke arbitrary upstream operations, including mutations. Discover command behavior first and obtain confirmation before mutations.

Artifact downloads reject path traversal and cross-origin redirects, preserve relative paths, and refuse existing files unless `--force` is passed. Downloads are untrusted data: use an empty directory and do not execute their contents. External artifact stores that redirect to another origin are unsupported.

For additional recipes, see the [operations guide](../../extensions/jenkins-cli-operations/references/OPERATIONS.md).

## Agent skill

The optional [`jenkins-cli-operations` skill](../../extensions/jenkins-cli-operations/README.md) adds agent workflow and confirmation instructions. It invokes `jenkins` on PATH and is released separately. The skill currently supports CLI `0.1.x`; pin that line for agent use rather than silently fetching the latest version during operations.

## Development and tests

From the repository root:

```bash
node packages/jenkins-cli/scripts/jenkins.mjs --help
pnpm --filter @stagefright5/jenkins-cli test
pnpm run packages:sync
pnpm run packages:stage
pnpm --dir packages/jenkins-cli pack --out "$PWD/.tmp/jenkins-cli.tgz"
# Optional local installation of the packed CLI:
npm install -g ./.tmp/jenkins-cli.tgz
```

Tests use mock Jenkins endpoints and do not require a live controller. Workspace packaging tests install the tarball into an isolated prefix and exercise the executable outside the repository. Source script paths are implementation details; use the public `jenkins` command in automation.
