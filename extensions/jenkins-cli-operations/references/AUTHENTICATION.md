# Authentication and installation

Paths in this reference are relative to the directory containing `SKILL.md`. Resolve script paths before execution rather than assuming the current working directory.

## Prerequisites

- Node.js 18 or newer
- Java compatible with the Jenkins controller
- Network access to the Jenkins base URL
- The official `jenkins-cli.jar` or a `jenkins-cli` launcher on `PATH`
- A Jenkins user ID and API token with the minimum required permissions

The Jenkins user ID may differ from an email address or display name, particularly with SSO. Find it on the Jenkins user page. Create an API token under **User → Configure → API Token**.

Never paste the token into chat, tickets, source control, or shell command arguments.

## Check for existing configuration

The default configuration path is:

- Windows: `%APPDATA%\jenkins-cli-operations\config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/jenkins-cli-operations/config.json`, or `~/.config/jenkins-cli-operations/config.json` when `XDG_CONFIG_HOME` is unset

`JENKINS_SKILL_CONFIG` or `--config PATH` overrides the default. If a configuration already exists, verify it before replacing it:

```bash
node scripts/jenkins.mjs -- who-am-i
```

The configuration contains connection and credential-provider metadata, not the API token itself.

## Install the official CLI

Download the jar from the target controller so client and server versions match.

Linux/macOS:

```bash
mkdir -p ~/.local/share/jenkins-cli
curl --fail --location \
  https://jenkins.example.com/jnlpJars/jenkins-cli.jar \
  --output ~/.local/share/jenkins-cli/jenkins-cli.jar
```

PowerShell:

```powershell
$Dir = Join-Path $env:LOCALAPPDATA 'jenkins-cli'
New-Item -ItemType Directory -Force $Dir | Out-Null
Invoke-WebRequest `
  -Uri 'https://jenkins.example.com/jnlpJars/jenkins-cli.jar' `
  -OutFile (Join-Path $Dir 'jenkins-cli.jar')
```

Do not use a CLI jar downloaded from an unrelated controller.

## Configure a credential provider

`configure.mjs` stores only non-secret connection and provider settings. Choose one provider below.

### Protected auth file

The auth file contains one line:

```text
JENKINS_USER_ID:API_TOKEN
```

Linux/macOS:

```bash
mkdir -p ~/.config/jenkins
umask 077
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
printf '%s:%s' "$JENKINS_USER_ID" "$JENKINS_API_TOKEN" > ~/.config/jenkins/cli-auth
chmod 600 ~/.config/jenkins/cli-auth
unset JENKINS_API_TOKEN

node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --jar ~/.local/share/jenkins-cli/jenkins-cli.jar \
  --auth-provider file \
  --auth-file ~/.config/jenkins/cli-auth
```

PowerShell:

```powershell
$Dir = Join-Path $env:APPDATA 'jenkins-cli'
New-Item -ItemType Directory -Force $Dir | Out-Null
$Credential = Get-Credential -Message 'Jenkins user ID and API token'
$Value = '{0}:{1}' -f $Credential.UserName, $Credential.GetNetworkCredential().Password
$AuthFile = Join-Path $Dir 'cli-auth'
[IO.File]::WriteAllText($AuthFile, $Value)
icacls $AuthFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
$Value = $null

node "scripts/configure.mjs" `
  --url https://jenkins.example.com `
  --jar "$env:LOCALAPPDATA\jenkins-cli\jenkins-cli.jar" `
  --auth-provider file `
  --auth-file $AuthFile
```

### Native credential store

The configuration stores a service label and Jenkins user ID. The helper copies the retrieved token into a temporary credential file only for the lifetime of each CLI invocation.

The default service label is `jenkins-cli:<jenkins-host>`.

#### macOS Keychain

```bash
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
security add-generic-password -U \
  -s 'jenkins-cli:jenkins.example.com' \
  -a "$JENKINS_USER_ID" \
  -w "$JENKINS_API_TOKEN"
unset JENKINS_API_TOKEN

node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --jar ~/.local/share/jenkins-cli/jenkins-cli.jar \
  --auth-provider keychain \
  --user-id "$JENKINS_USER_ID"
```

#### Linux Secret Service

A desktop keyring or other Secret Service implementation must be available and unlocked:

```bash
sudo apt-get install libsecret-tools
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
printf '%s' "$JENKINS_API_TOKEN" | secret-tool store \
  --label='Jenkins CLI API token' \
  service 'jenkins-cli:jenkins.example.com' \
  account "$JENKINS_USER_ID"
unset JENKINS_API_TOKEN
```

Configure with the same `--auth-provider keychain --user-id ID` options shown for macOS. On a headless system without Secret Service, use a protected auth file or environment injection.

#### Windows Credential Manager

```powershell
Install-Module CredentialManager -Scope CurrentUser
$Credential = Get-Credential -Message 'Jenkins user ID and API token'
New-StoredCredential `
  -Target 'jenkins-cli:jenkins.example.com' `
  -UserName $Credential.UserName `
  -Password $Credential.GetNetworkCredential().Password `
  -Persist LocalMachine | Out-Null

node "scripts/configure.mjs" `
  --url https://jenkins.example.com `
  --jar "$env:LOCALAPPDATA\jenkins-cli\jenkins-cli.jar" `
  --auth-provider keychain `
  --user-id $Credential.UserName
```

The helper uses `Get-StoredCredential`; verify availability with `Get-Command Get-StoredCredential`.

### Environment injection

Use this provider for ephemeral shells populated by a secret manager:

```bash
export JENKINS_USER_ID='...'
export JENKINS_API_TOKEN='...'
node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --auth-provider env
```

Do not put these exports in shell profiles or committed `.env` files. The helper creates and removes a temporary auth file for each invocation.

## Launcher and transport options

Use `--jar PATH` for a downloaded jar or `--command NAME` for a launcher on `PATH`. If neither is supplied, the launcher defaults to `jenkins-cli`.

WebSocket is the default transport. Use `--transport http` only when the controller or reverse proxy does not support the WebSocket upgrade:

```bash
node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --command jenkins-cli \
  --auth-provider file \
  --auth-file ~/.config/jenkins/cli-auth \
  --transport http
```

## Verify and rotate

```bash
node scripts/jenkins.mjs -- who-am-i
node scripts/jenkins.mjs -- help
```

An HTTP 401 normally means the Jenkins user ID/token pair is invalid. Do not bypass authentication or TLS checks.

If a token is exposed, revoke it in Jenkins, create a replacement, update the selected provider, and rerun `who-am-i`.
