# Authentication and installation

Install the standalone CLI with `npm install -g @stagefright5/jenkins-cli@0.1`, then run `jenkins --version`. It must identify `@stagefright5/jenkins-cli` version `0.1.x`. The skill does not bundle the executable or automatically add it to PATH. Use `jenkins` from any working directory.

## Reuse existing configuration

Start with `jenkins profiles --json`. This reads only non-secret metadata, not tokens or credential stores.

Configuration location:

- Windows: `%APPDATA%\jenkins-cli-operations\config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/jenkins-cli-operations/config.json`, or `~/.config/jenkins-cli-operations/config.json`
- Override: `JENKINS_SKILL_CONFIG` or explicit `--config PATH`

Verify a selected profile with `jenkins --profile NAME whoami`. Do not recreate working configuration or fall back to another account on authentication failure.

## Named profiles

Each profile pairs a controller/launcher with one credential-provider reference. Profiles can share a controller with different users or tokens, or connect to different controllers. Tokens are never stored in the config.

```bash
jenkins configure --profile staging \
  --url https://staging.example.com \
  --jar ~/.local/share/jenkins-cli/staging.jar \
  --auth-provider file --auth-file ~/.config/jenkins/staging-auth \
  --default

jenkins configure --profile production \
  --url https://production.example.com \
  --jar ~/.local/share/jenkins-cli/production.jar \
  --auth-provider keychain --user-id build-bot \
  --service jenkins-cli:production:build-bot
```

`configure` writes local metadata only; it does not contact Jenkins or create credentials. Obtain the user's agreement before replacing a profile or changing the default. Existing named profiles require `--replace` to overwrite; unrelated profiles remain unchanged. Supply the complete connection/provider options when replacing a profile, not just the fields to change. `--default` sets the default to the configured profile; omitting it preserves the current default.

An explicit `--profile NAME` takes precedence over `JENKINS_SKILL_PROFILE`, then `defaultProfile`, then a sole profile. More than one profile without a default requires explicit selection. Unknown names fail, with no credential fallback. Configuration writes require an explicit profile name and do not use `JENKINS_SKILL_PROFILE` to choose a write target.

Profile names start with a letter or number and contain only letters, numbers, `.`, `_`, or `-`. Reserved JavaScript object-property names are rejected.

Example metadata format:

```json
{
  "version": 2,
  "defaultProfile": "reader",
  "profiles": {
    "reader": {
      "url": "https://jenkins.example.com",
      "command": "jenkins-cli",
      "transport": "webSocket",
      "auth": { "provider": "file", "path": "/home/me/.config/jenkins/reader-auth" }
    },
    "builder": {
      "url": "https://jenkins.example.com",
      "command": "jenkins-cli",
      "transport": "webSocket",
      "auth": {
        "provider": "env",
        "userVariable": "JENKINS_BUILDER_USER",
        "tokenVariable": "JENKINS_BUILDER_TOKEN"
      }
    }
  }
}
```

### Compatibility and migration

Existing single-connection files work unchanged as profile `default`. Read-only commands never rewrite them. Adding a named profile migrates the file to version 2, retaining the old connection as `default` and keeping it selected by default. Adding/replacing a profile named `default` requires `--replace` when that legacy connection exists.

For legacy callers, configuration without `--profile` still creates/replaces a single-connection file. It refuses to overwrite a version-2 profile collection. Prefer explicit profiles for all new setup.

Back up metadata before adopting profiles if you need to use older versions of this skill. Older helpers do not understand version 2. To roll back, restore the previous metadata file or extract one profile's connection into a separate legacy config and select it with `--config`. No credential-store migration is needed.

Writes are locked and atomically replaced. If interrupted during configuration, a `.lock` file may remain. Remove it only after verifying that no configuration writer is running.

## Prerequisites and CLI installation

Use Node.js 18+, Java compatible with the controller, network access, and a Jenkins user ID/API token with the minimum permissions. A Jenkins user ID can differ from an email address or SSO display name. Create tokens under the Jenkins user page, Configure, API Token. Never paste a token into chat or commit it.

Download each CLI jar from its matching controller:

```bash
mkdir -p ~/.local/share/jenkins-cli
curl --fail --location https://jenkins.example.com/jnlpJars/jenkins-cli.jar \
  --output ~/.local/share/jenkins-cli/jenkins.jar
```

PowerShell:

```powershell
$Dir = Join-Path $env:LOCALAPPDATA 'jenkins-cli'
New-Item -ItemType Directory -Force $Dir | Out-Null
Invoke-WebRequest -Uri 'https://jenkins.example.com/jnlpJars/jenkins-cli.jar' `
  -OutFile (Join-Path $Dir 'jenkins.jar')
```

Configure with `--jar PATH`, or `--command NAME` for a launcher on PATH. The default upstream launcher is `jenkins-cli`; it is distinct from this package's `jenkins` command. Do not configure `--command jenkins`, which would invoke this wrapper instead of the upstream CLI. Default transport is WebSocket; use `--transport http` only when needed for proxy compatibility. Never disable TLS verification.

## Credential providers

Use a separate auth file, environment-variable pair, or keychain entry for each distinct credential. Sharing a reference deliberately shares its credential; a profile name alone does not isolate secrets.

### Protected auth file

The file contains `JENKINS_USER_ID:API_TOKEN`. Have the user create it privately in their terminal, not through chat. For example, in Bash on Linux/macOS:

```bash
mkdir -p ~/.config/jenkins
umask 077
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
printf '%s:%s' "$JENKINS_USER_ID" "$JENKINS_API_TOKEN" > ~/.config/jenkins/reader-auth
chmod 600 ~/.config/jenkins/reader-auth
unset JENKINS_API_TOKEN
```

PowerShell:

```powershell
$Dir = Join-Path $env:APPDATA 'jenkins-cli'
New-Item -ItemType Directory -Force $Dir | Out-Null
$Credential = Get-Credential -Message 'Jenkins user ID and API token'
$Value = '{0}:{1}' -f $Credential.UserName, $Credential.GetNetworkCredential().Password
$AuthFile = Join-Path $Dir 'reader-auth'
[IO.File]::WriteAllText($AuthFile, $Value)
icacls $AuthFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
$Value = $null
$Credential = $null
```

Then configure using only the file path:

```bash
jenkins configure --profile reader \
  --url https://jenkins.example.com --jar /path/to/jenkins.jar \
  --auth-provider file --auth-file /path/to/reader-auth
```

### Native credential store

Configure `--auth-provider keychain --user-id ID --service LABEL`. Without `--service`, the label defaults to `jenkins-cli:<jenkins-host>`. For multiple tokens belonging to the same user, use distinct service labels. On Windows, use a distinct service label for every account as well. Credential Manager looks up entries by target, not user ID.

- On macOS, create a generic password entry in Keychain Access with the chosen service label, Jenkins user ID as account, and token as password. Use the GUI to avoid putting the token in command arguments.
- On Linux, use an unlocked Secret Service session and `secret-tool`. In a private terminal, pipe the token into storage rather than passing it as an argument:

  ```bash
  read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
  read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
  printf '%s' "$JENKINS_API_TOKEN" | secret-tool store \
    --label='Jenkins reader token' service 'jenkins-cli:example:reader' account "$JENKINS_USER_ID"
  unset JENKINS_API_TOKEN
  ```

- On Windows, use the `CredentialManager` PowerShell module and a private prompt:

  ```powershell
  $Credential = Get-Credential -Message 'Jenkins user ID and API token'
  New-StoredCredential -Target 'jenkins-cli:example:reader' `
    -UserName $Credential.UserName -Password $Credential.GetNetworkCredential().Password `
    -Persist LocalMachine | Out-Null
  $Credential = $null
  ```

The helper retrieves the selected entry only and creates a temporary protected auth file for the CLI invocation. For a headless Linux environment without Secret Service, use file or environment credentials.

### Environment injection

Have a secret manager populate environment variables; do not put tokens in shell profiles or committed `.env` files. Separate profiles can use separate variable names:

```bash
jenkins configure --profile builder \
  --url https://jenkins.example.com --jar /path/to/jenkins.jar \
  --auth-provider env --user-variable JENKINS_BUILDER_USER --token-variable JENKINS_BUILDER_TOKEN
```

Defaults are `JENKINS_USER_ID` and `JENKINS_API_TOKEN`. The helper creates and removes a temporary auth file for each CLI invocation.

## Verify and rotate

Run `jenkins --profile NAME whoami`. If a token is exposed, revoke it in Jenkins, create a replacement, update that profile's credential provider, and verify again. Never test alternative identities automatically after a 401/403.
