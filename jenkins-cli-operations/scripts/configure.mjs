#!/usr/bin/env node
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { consumeConfigArg, defaultConfigPath } from './lib/config.mjs';

function usage() {
    console.log(`Usage:
  node configure.mjs --url URL [launcher] [auth] [--transport webSocket|http] [--config PATH]

Launcher (choose at most one):
  --jar PATH                 Invoke java -jar PATH
  --command COMMAND          Invoke a jenkins-cli launcher on PATH (default: jenkins-cli)

Authentication:
  --auth-provider file --auth-file PATH
  --auth-provider env [--user-variable NAME] [--token-variable NAME]
  --auth-provider keychain --user-id ID [--service NAME]

This script stores configuration only. It never accepts or stores an API token.`);
}

function option(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
}

async function main() {
    const consumed = consumeConfigArg(process.argv.slice(2));
    const args = consumed.args;
    if (args.includes('--help') || args.includes('-h')) return usage();

    const url = option(args, '--url');
    const transport = option(args, '--transport') || 'webSocket';
    const jarPath = option(args, '--jar');
    const command = option(args, '--command');
    const provider = option(args, '--auth-provider');
    const authFile = option(args, '--auth-file');
    const userVariable = option(args, '--user-variable');
    const tokenVariable = option(args, '--token-variable');
    const userId = option(args, '--user-id');
    const service = option(args, '--service');
    if (args.length) throw new Error(`Unknown arguments: ${args.join(' ')}`);
    if (!url) throw new Error('--url is required');
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url)) {
        throw new Error('Use an HTTPS Jenkins URL (HTTP is allowed only for localhost)');
    }
    if (!['webSocket', 'http'].includes(transport)) throw new Error('--transport must be webSocket or http');
    if (jarPath && command) throw new Error('Choose either --jar or --command, not both');
    if (!['file', 'env', 'keychain'].includes(provider)) throw new Error('--auth-provider must be file, env, or keychain');

    let auth;
    if (provider === 'file') {
        if (!authFile) throw new Error('file auth requires --auth-file');
        auth = { provider, path: path.resolve(authFile) };
    } else if (provider === 'env') {
        auth = {
            provider,
            userVariable: userVariable || 'JENKINS_USER_ID',
            tokenVariable: tokenVariable || 'JENKINS_API_TOKEN',
        };
    } else {
        if (!userId) throw new Error('keychain auth requires --user-id');
        auth = {
            provider,
            userId,
            service: service || `jenkins-cli:${new URL(url).host}`,
        };
    }

    const config = {
        url: url.replace(/\/+$/, ''),
        transport,
        ...(jarPath ? { jarPath: path.resolve(jarPath) } : { command: command || 'jenkins-cli' }),
        auth,
    };
    const configPath = consumed.configPath || defaultConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(configPath, 0o600);
    console.log(`Wrote non-secret Jenkins configuration to ${configPath}`);
    console.log('Next: node scripts/jenkins.mjs -- who-am-i');
}

main().catch((error) => {
    console.error(`Configuration failed: ${error.message}`);
    process.exit(1);
});
