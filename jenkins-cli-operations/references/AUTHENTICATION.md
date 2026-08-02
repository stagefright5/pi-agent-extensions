# Authentication and installation

## Prerequisites

- Node.js 18 or newer
- Java version compatible with the Jenkins controller
- Network access to the Jenkins base URL
- Official `jenkins-cli.jar` or a `jenkins-cli` launcher on `PATH`
- Jenkins user ID and API token with the minimum required permissions

The Jenkins user ID may differ from an email address or display name, especially with Entra ID/SSO. Find it on the Jenkins user page. Create an API token under **User → Configure → API Token**.

Never paste a token into chat, tickets, source control, or ordinary build parameters.

## Install the official CLI

Download from the target controller so client/server versions match.

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
Invoke-WebRequest \
  -Uri 'https://jenkins.example.com/jnlpJars/jenkins-cli.jar' \
  -OutFile (Join-Path $Dir 'jenkins-cli.jar')
```

Point `configure.mjs --jar` at the downloaded file. Do not download a CLI jar from an unrelated controller.

## Provider: protected auth file

The file contains one line:

```text
JENKINS_USER_ID:API_TOKEN
```

### Linux/macOS

Create it outside any repository and restrict permissions:

```bash
mkdir -p ~/.config/jenkins
umask 077
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
printf '%s:%s' "$JENKINS_USER_ID" "$JENKINS_API_TOKEN" > ~/.config/jenkins/cli-auth
chmod 600 ~/.config/jenkins/cli-auth
unset JENKINS_API_TOKEN
```

Configure:

```bash
node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --jar ~/.local/share/jenkins-cli/jenkins-cli.jar \
  --auth-provider file \
  --auth-file ~/.config/jenkins/cli-auth
```

### Windows PowerShell

```powershell
$Dir = Join-Path $env:APPDATA 'jenkins-cli'
New-Item -ItemType Directory -Force $Dir | Out-Null
$Credential = Get-Credential -Message 'Jenkins user ID and API token'
$Value = '{0}:{1}' -f $Credential.UserName, $Credential.GetNetworkCredential().Password
$AuthFile = Join-Path $Dir 'cli-auth'
[IO.File]::WriteAllText($AuthFile, $Value)
icacls $AuthFile /inheritance:r /grant:r "${env:USERNAME}:(R,W)"
$Value = $null
```

Configure:

```powershell
node "$SkillDir\scripts\configure.mjs" `
  --url https://jenkins.example.com `
  --jar "$env:LOCALAPPDATA\jenkins-cli\jenkins-cli.jar" `
  --auth-provider file `
  --auth-file $AuthFile
```

## Provider: native credential store

The configuration stores only a service label and Jenkins user ID. The token remains in the OS credential store and is copied into a temporary mode-600 file only while the CLI process runs.

Default service label:

```text
jenkins-cli:<jenkins-host>
```

### macOS Keychain

Store the token using a local secure prompt:

```bash
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
security add-generic-password -U \
  -s 'jenkins-cli:jenkins.example.com' \
  -a "$JENKINS_USER_ID" \
  -w "$JENKINS_API_TOKEN"
unset JENKINS_API_TOKEN
```

Configure:

```bash
node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --jar ~/.local/share/jenkins-cli/jenkins-cli.jar \
  --auth-provider keychain \
  --user-id "$JENKINS_USER_ID"
```

### Ubuntu/Linux Secret Service

Install the client (desktop keyring/Secret Service must also be available):

```bash
sudo apt-get install libsecret-tools
```

Store the token; `secret-tool` reads the secret from standard input:

```bash
read -r -p 'Jenkins user ID: ' JENKINS_USER_ID
read -r -s -p 'Jenkins API token: ' JENKINS_API_TOKEN; echo
printf '%s' "$JENKINS_API_TOKEN" | secret-tool store \
  --label='Jenkins CLI API token' \
  service 'jenkins-cli:jenkins.example.com' \
  account "$JENKINS_USER_ID"
unset JENKINS_API_TOKEN
```

Configure with the same `--auth-provider keychain --user-id ...` command. On headless Linux without Secret Service, use a protected auth file or environment injection from a secret manager.

### Windows Credential Manager

Install the PowerShell module for the current user:

```powershell
Install-Module CredentialManager -Scope CurrentUser
```

Store with a secure prompt:

```powershell
$Credential = Get-Credential -Message 'Jenkins user ID and API token'
New-StoredCredential `
  -Target 'jenkins-cli:jenkins.example.com' `
  -UserName $Credential.UserName `
  -Password $Credential.GetNetworkCredential().Password `
  -Persist LocalMachine | Out-Null
```

Configure:

```powershell
node "$SkillDir\scripts\configure.mjs" `
  --url https://jenkins.example.com `
  --jar "$env:LOCALAPPDATA\jenkins-cli\jenkins-cli.jar" `
  --auth-provider keychain `
  --user-id $Credential.UserName
```

The helper uses `Get-StoredCredential`; verify it with `Get-Command Get-StoredCredential`.

## Provider: environment

Use for ephemeral CI shells backed by a secret manager:

```bash
export JENKINS_USER_ID='...'
export JENKINS_API_TOKEN='...'
node scripts/configure.mjs \
  --url https://jenkins.example.com \
  --auth-provider env
```

Do not put these exports in shell profiles or committed `.env` files. The helper writes a temporary auth file and removes it after each invocation.

## Verification and rotation

Verify:

```bash
node scripts/jenkins.mjs -- who-am-i
```

HTTP 401 means the user ID/token pair is invalid. SSO display names and email addresses are not guaranteed to be the Jenkins user ID.

If a token appears in chat, logs, process output, source control, or an ordinary build parameter:

1. Revoke it in Jenkins immediately.
2. Create a replacement token.
3. Update the protected file or native credential store.
4. Re-run `who-am-i`.
