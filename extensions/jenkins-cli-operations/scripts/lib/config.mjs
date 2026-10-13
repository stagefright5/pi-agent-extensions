import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function defaultConfigPath() {
    if (process.env.JENKINS_SKILL_CONFIG) return path.resolve(process.env.JENKINS_SKILL_CONFIG);
    const root =
        process.platform === 'win32'
            ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
            : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    return path.join(root, 'jenkins-cli-operations', 'config.json');
}

// Wrapper options stop at -- so upstream CLI arguments are never consumed.
export function consumeConfigArg(argv) {
    const args = [...argv];
    const values = {};
    for (let i = 0; i < args.length && args[i] !== '--'; i++) {
        const name = args[i];
        if (!['--config', '--profile'].includes(name)) continue;
        if (Object.hasOwn(values, name)) throw new Error(`${name} may only be specified once`);
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
        values[name] = args[i + 1];
        args.splice(i, 2);
        i--;
    }
    return {
        configPath: values['--config'] ? path.resolve(values['--config']) : defaultConfigPath(),
        profile: values['--profile'],
        args,
    };
}

export function validateProfileName(name) {
    if (
        typeof name !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ||
        ['__proto__', 'constructor', 'prototype'].includes(name)
    ) {
        throw new Error(
            'Profile names must start with a letter or number and contain only letters, numbers, ., _, or -',
        );
    }
    return name;
}

export function validateConnection(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.url)
        throw new Error('Jenkins connection is missing url');
    let url;
    try {
        url = new URL(parsed.url);
    } catch {
        throw new Error('Invalid Jenkins URL');
    }
    if (url.username || url.password || url.search || url.hash)
        throw new Error('Jenkins URL must not contain credentials, a query, or a fragment');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
        throw new Error('Jenkins URL must use HTTPS (HTTP is allowed only for localhost)');
    if (!['file', 'env', 'keychain'].includes(parsed.auth?.provider))
        throw new Error('Jenkins connection requires auth.provider: file, env, or keychain');
    if (!['websocket', 'http'].includes(String(parsed.transport || 'webSocket').toLowerCase()))
        throw new Error('Unsupported transport; use webSocket or http');
    return { ...parsed, url: url.href.replace(/\/+$/, '') };
}

export function normalizeConfig(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Jenkins configuration must be an object');
    if (!Object.hasOwn(parsed, 'profiles')) {
        return { version: 2, defaultProfile: 'default', profiles: { default: validateConnection(parsed) } };
    }
    if (parsed.version !== 2) throw new Error('Unsupported Jenkins configuration version');
    if (!parsed.profiles || typeof parsed.profiles !== 'object' || Array.isArray(parsed.profiles))
        throw new Error('profiles must be an object');
    for (const [name, connection] of Object.entries(parsed.profiles)) {
        validateProfileName(name);
        validateConnection(connection);
    }
    if (
        parsed.defaultProfile !== undefined &&
        (typeof parsed.defaultProfile !== 'string' || !Object.hasOwn(parsed.profiles, parsed.defaultProfile))
    )
        throw new Error('defaultProfile does not name a configured profile');
    return parsed;
}

export async function readConfigDocument(configPath = defaultConfigPath()) {
    let content;
    try {
        content = await readFile(configPath, 'utf8');
    } catch (error) {
        throw new Error(
            `Unable to read Jenkins skill config at ${configPath} (${error.code || 'read failure'}); run configure`,
            { cause: error },
        );
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error(`Invalid JSON in Jenkins skill config at ${configPath}`);
    }
    normalizeConfig(parsed);
    return parsed;
}

export async function loadConfig(configPath = defaultConfigPath(), profile) {
    const document = normalizeConfig(await readConfigDocument(configPath));
    const names = Object.keys(document.profiles);
    const selected =
        profile ??
        process.env.JENKINS_SKILL_PROFILE ??
        document.defaultProfile ??
        (names.length === 1 ? names[0] : undefined);
    if (!selected)
        throw new Error(
            'Multiple or no Jenkins profiles configured; select one with --profile NAME (use profiles to list)',
        );
    if (!Object.hasOwn(document.profiles, selected))
        throw new Error(`Unknown Jenkins profile: ${selected}; use profiles to list`);
    return { ...validateConnection(document.profiles[selected]), configPath, profile: selected };
}

// Deliberately allowlist metadata; never resolve credentials while listing profiles.
export async function listProfiles(configPath = defaultConfigPath()) {
    const document = normalizeConfig(await readConfigDocument(configPath));
    return {
        configPath,
        defaultProfile: document.defaultProfile ?? null,
        environmentProfile: process.env.JENKINS_SKILL_PROFILE ?? null,
        profiles: Object.entries(document.profiles).map(([name, connection]) => ({
            name,
            url: validateConnection(connection).url,
            provider: connection.auth.provider,
            ...(connection.auth.provider === 'keychain' ? { userId: connection.auth.userId } : {}),
        })),
    };
}

function runCapture(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
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

    if (config.jarPath)
        return { command: config.javaCommand || 'java', args: ['-jar', path.resolve(config.jarPath), ...globalArgs] };
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
    const parts = String(jobName)
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!parts.length) throw new Error('Job name must not be empty');
    return parts.map((part) => `job/${encodeURIComponent(part)}`).join('/');
}

export async function inspectJob(config, jobName) {
    const credential = await readCredential(config);
    const tree =
        'name,url,buildable,inQueue,nextBuildNumber,property[parameterDefinitions[name,type,description,defaultParameterValue[value]]]';
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
