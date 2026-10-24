// Shared by the public command and the legacy helper entry points.
const commands = {
    profiles: `Usage:
  jenkins profiles [--json]

List safe profile metadata without retrieving credentials or contacting Jenkins.
Includes the controller, credential-provider type, configured default, and environment selection.

Options:
  --json                      Print machine-readable metadata

Examples:
  jenkins profiles
  jenkins profiles --json`,
    configure: `Usage:
  jenkins configure [--profile NAME] --url URL [launcher] [auth] [options]

Add or replace local connection metadata. Does not contact Jenkins or store API tokens.

Connection and profiles:
  --url URL                   Jenkins controller URL (HTTPS required except localhost)
  --profile NAME              Add a named connection without changing other profiles
  --replace                   Explicitly replace an existing named profile
  --default                   Make this profile the default
  --transport webSocket|http  Transport (default: webSocket)

Launcher (choose at most one):
  --jar PATH                  Invoke java -jar PATH
  --command COMMAND           Upstream launcher on PATH (default: jenkins-cli, NOT jenkins)

Authentication (required; select a provider):
  --auth-provider file --auth-file PATH
  --auth-provider env [--user-variable NAME] [--token-variable NAME]
  --auth-provider keychain --user-id ID [--service NAME]

Environment defaults: JENKINS_USER_ID and JENKINS_API_TOKEN.
Configuration writes require an explicit --profile for named profiles; environment selection is not used.
Without --profile, legacy single-connection configuration remains supported.

Example:
  jenkins configure --profile staging --url https://jenkins.example.com --jar /path/to/jenkins-cli.jar --auth-provider file --auth-file /path/to/auth`,
    whoami: `Usage:
  jenkins whoami

Verify the selected credential by invoking the upstream who-am-i command.
Contacts Jenkins; does not change Jenkins state or try alternative credentials.

Example:
  jenkins --profile staging whoami`,
    jobs: `Usage:
  jenkins jobs [FOLDER]

List visible jobs at the root or within a folder. Contacts Jenkins; read-only.
Use the full folder name, including parent folders separated by /.

Examples:
  jenkins --profile staging jobs
  jenkins --profile staging jobs 'Team/Folder'`,
    inspect: `Usage:
  jenkins [--config PATH] [--profile NAME] inspect JOB [--json]

Inspect a job's declared parameters, defaults, buildability, and queue status.
Contacts Jenkins; read-only. Sensitive parameter defaults are redacted.

Arguments:
  JOB                         Full job name, including folders separated by /

Options:
  --json                      Print machine-readable job details

Example:
  jenkins --profile staging inspect 'Folder/Job' --json`,
    build: `Usage:
  jenkins [--config PATH] [--profile NAME] build JOB [options]

Inspect and validate a job, then dry-run or trigger a build.

Arguments:
  JOB                         Full job name, including folders separated by /

Parameters:
  --param NAME=VALUE          Repeatable build parameter; overrides parameter-file values
  --params-file PATH          JSON object containing build parameters
  Omitted parameters use Jenkins defaults. Do not put secrets in command arguments.

Execution:
  --dry-run                   Inspect, validate, and summarize without queueing a build
  --follow                    Wait for the final Jenkins result
  --verbose                   Stream console output; requires --follow
  --yes                       Execute without interactive confirmation

Safety:
  Without --yes, type "trigger JOB" interactively. Non-interactive execution requires --yes.
  Agents may use --yes only after presenting the summary and obtaining fresh explicit user confirmation.
  --dry-run takes precedence over --yes. Without --follow, queue and return; this does not mean success.
  Interrupting local follow does not necessarily stop the server-side build.

Example:
  jenkins --profile staging build 'Folder/Job' --param BRANCH=main --follow --dry-run`,
    console: `Usage:
  jenkins console JOB [BUILD]

Read console output through the upstream Jenkins CLI. Contacts Jenkins; read-only.

Arguments:
  JOB                         Full job name, including folders separated by /
  BUILD                       Build number or permalink; omitted uses the upstream default

Example:
  jenkins --profile staging console 'Folder/Job' 123`,
    artifacts: `Usage:
  jenkins artifacts JOB [BUILD] [--json]

List archived artifacts using authenticated REST requests. Contacts Jenkins; read-only.

Arguments:
  JOB                         Full job name, including folders separated by /
  BUILD                       Build number or permalink (default: lastSuccessfulBuild)

Options:
  --json                      Print machine-readable build and artifact metadata

Example:
  jenkins --profile staging artifacts 'Folder/Job' 123 --json`,
    download: `Usage:
  jenkins download JOB BUILD (--all | --artifact PATH ...) --out DIR [options]

Download archived artifacts. Read-only on Jenkins; writes files locally.

Arguments:
  JOB                         Full job name, including folders separated by /
  BUILD                       Required build number or permalink

Options:
  --all                       Download all archived artifacts
  --artifact PATH             Select an artifact's relative path; repeatable, cannot combine with --all
  --out DIR                   Required local output directory
  --force                     Replace existing files (default: refuse overwrites)
  --json                      Print machine-readable download results

Relative paths are preserved under DIR. Escaping paths and cross-origin redirects are rejected.
Treat downloads as untrusted data; prefer an empty output directory and do not execute them.

Example:
  jenkins --profile staging download 'Folder/Job' 123 --all --out /path/to/output`,
    cli: `Usage:
  jenkins cli -- COMMAND [arguments]

Pass arguments after -- unchanged to the official Jenkins CLI.
This may contact Jenkins and does not classify or enforce mutation confirmation.
Discover the command's behavior and obtain confirmation before any mutation.

Help:
  jenkins cli --help                  Show this local wrapper help without contacting Jenkins
  jenkins cli -- help COMMAND         Ask Jenkins for upstream command help (requires authentication)
  Flags after --, including --help and -h, belong to the upstream CLI.

Legacy form:
  jenkins -- COMMAND [arguments]`,
};

export function hasHelp(args) {
    const separator = args.indexOf('--');
    return args.slice(0, separator < 0 ? args.length : separator).some((arg) => arg === '--help' || arg === '-h');
}

export function commandHelp(command) {
    if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command: ${command}; use jenkins --help`);
    return `${commands[command]}

Global options (before --):
  --config PATH               Override JENKINS_SKILL_CONFIG / the default config location
  --profile NAME              Select a connection profile (configure uses this as its write target)
  -h, --help                  Show command help without reading configuration or contacting Jenkins

Selection: --profile > JENKINS_SKILL_PROFILE > configured default > sole profile.
Use jenkins help COMMAND or jenkins COMMAND --help for command-specific help.`;
}
