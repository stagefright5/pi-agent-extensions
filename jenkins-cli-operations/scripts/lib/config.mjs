import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function defaultConfigPath() {
    if (process.env.JENKINS_SKILL_CONFIG) return path.resolve(process.env.JENKINS_SKILL_CONFIG);
    const root = process.platform === 'win32'
        ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(root, 'jenkins-cli-operations', 'config.json');
}

export function consumeConfigArg(argv) {
    const args = [...argv];
    let configPath = defaultConfigPath();
    const index = args.indexOf('--config');
    if (index >= 0) {
        if (!args[index + 1]) throw new Error('--config requires a path');
        configPath = path.resolve(args[index + 1]);
        args.splice(index, 2);
    }
    return { configPath, args };
}

export async function loadConfig(configPath = defaultConfigPath()) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(configPath, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read Jenkins skill config at ${configPath}: ${error.message}`);
    }
    if (!parsed.url) throw new Error(`Jenkins config ${configPath} is missing url`);
    const url = String(parsed.url).replace(/\/+$/, '');
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) {
        throw new Error('Jenkins URL must use HTTPS (HTTP is allowed only for localhost)');
    }
    if (!parsed.auth?.provider) throw new Error(`Jenkins config ${configPath} is missing auth.provider`);
    return { ...parsed, url, configPath };
}

function runCapture(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(`${command} failed with exit ${code}: ${stderr.trim() || 'no diagnostic output'}`));
        });
    });
}

async function assertProtectedFile(filePath) {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Credential path is not a file: ${filePath}`);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        throw new Error(`Credential file ${filePath} is accessible by group/others; run chmod 600`);
    }
}

async function credentialFromFile(auth) {
    const filePath = path.resolve(String(auth.path || ''));
    if (!filePath) throw new Error('file auth provider requires auth.path');
    await assertProtectedFile(filePath);
    const value = (await readFile(filePath, 'utf8')).trim();
    if (!value.includes(':')) throw new Error('Credential file must contain JENKINS_USER_ID:API_TOKEN');
    return { directFile: filePath, credential: null };
}

function credentialFromEnv(auth) {
    const userVariable = auth.userVariable || 'JENKINS_USER_ID';
    const tokenVariable = auth.tokenVariable || 'JENKINS_API_TOKEN';
    const user = process.env[userVariable];
    const token = process.env[tokenVariable];
    if (!user || !token) throw new Error(`Environment auth requires ${userVariable} and ${tokenVariable}`);
    return `${user}:${token}`;
}

async function credentialFromKeychain(auth) {
    const userId = String(auth.userId || '').trim();
    const service = String(auth.service || '').trim();
    if (!userId || !service) throw new Error('keychain auth requires auth.userId and auth.service');

    let token;
    if (process.platform === 'darwin') {
        token = await runCapture('security', ['find-generic-password', '-s', service, '-a', userId, '-w']);
    } else if (process.platform === 'linux') {
        token = await runCapture('secret-tool', ['lookup', 'service', service, 'account', userId]);
    } else if (process.platform === 'win32') {
        const script = [
            "$ErrorActionPreference='Stop'",
            'Import-Module CredentialManager',
            '$c=Get-StoredCredential -Target $env:JENKINS_KEYCHAIN_SERVICE',
            "if ($null -eq $c) { throw 'Credential not found' }",
            '[Console]::Out.Write($c.Password)',
        ].join(';');
        token = await runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            env: { ...process.env, JENKINS_KEYCHAIN_SERVICE: service },
        });
    } else {
        throw new Error(`Native keychain provider is unsupported on ${process.platform}; use file or env auth`);
    }
    if (!token) throw new Error(`No token found in native credential store for ${service}/${userId}`);
    return `${userId}:${token}`;
}

export async function withAuthFile(config, callback) {
    if (config.auth.provider === 'file') {
        const { directFile } = await credentialFromFile(config.auth);
        return callback(directFile);
    }

    let credential;
    if (config.auth.provider === 'env') credential = credentialFromEnv(config.auth);
    else if (config.auth.provider === 'keychain') credential = await credentialFromKeychain(config.auth);
    else throw new Error(`Unsupported auth provider: ${config.auth.provider}`);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jenkins-cli-auth-'));
    const authPath = path.join(tempDir, 'auth');
    try {
        await writeFile(authPath, credential, { mode: 0o600 });
        if (process.platform !== 'win32') await chmod(authPath, 0o600);
        return await callback(authPath);
    } finally {
        credential = '';
        await rm(tempDir, { recursive: true, force: true });
    }
}

export function cliInvocation(config, authFile, commandArgs) {
    const globalArgs = ['-s', config.url];
    const transport = String(config.transport || 'webSocket').toLowerCase();
    if (transport === 'http') globalArgs.push('-http');
    else if (transport === 'websocket') globalArgs.push('-webSocket');
    else throw new Error(`Unsupported transport '${config.transport}'; use webSocket or http`);
    globalArgs.push('-auth', `@${authFile}`, ...commandArgs);

    if (config.jarPath) return { command: config.javaCommand || 'java', args: ['-jar', path.resolve(config.jarPath), ...globalArgs] };
    return { command: config.command || 'jenkins-cli', args: globalArgs };
}

export function spawnInherited(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code: code ?? 1, signal }));
    });
}

export async function readCredential(config) {
    if (config.auth.provider === 'file') {
        const { directFile } = await credentialFromFile(config.auth);
        return (await readFile(directFile, 'utf8')).trim();
    }
    if (config.auth.provider === 'env') return credentialFromEnv(config.auth);
    if (config.auth.provider === 'keychain') return credentialFromKeychain(config.auth);
    throw new Error(`Unsupported auth provider: ${config.auth.provider}`);
}

export function jobApiPath(jobName) {
    const parts = String(jobName).split('/').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Job name must not be empty');
    return parts.map((part) => `job/${encodeURIComponent(part)}`).join('/');
}

export async function inspectJob(config, jobName) {
    const credential = await readCredential(config);
    const tree = 'name,url,buildable,inQueue,nextBuildNumber,property[parameterDefinitions[name,type,description,defaultParameterValue[value]]]';
    const url = `${config.url}/${jobApiPath(jobName)}/api/json?tree=${encodeURIComponent(tree)}`;
    const response = await fetch(url, {
        headers: { Authorization: `Basic ${Buffer.from(credential).toString('base64')}` },
    });
    if (!response.ok) throw new Error(`Jenkins job inspection returned HTTP ${response.status} for ${jobName}`);
    return response.json();
}

export function parameterDefinitions(job) {
    return (job.property || []).flatMap((property) => property.parameterDefinitions || []);
}

export function isSensitiveName(name) {
    return /(password|secret|token|credential|private|(^|_)key($|_)|auth)/i.test(String(name));
}
