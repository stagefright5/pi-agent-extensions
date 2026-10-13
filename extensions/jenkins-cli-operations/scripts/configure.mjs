#!/usr/bin/env node
import path from 'node:path';

import { consumeConfigArg, validateConnection } from './lib/config.mjs';
import { saveConnection } from './lib/save-config.mjs';

function usage() {
    console.log(`Usage:
  node configure.mjs [--profile NAME] --url URL [launcher] [auth] [--transport webSocket|http] [--config PATH]

Profiles:
  --profile NAME             Add a named connection without changing other profiles
  --replace                  Explicitly replace an existing named profile
  --default                  Make this profile the default

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
    const replace = args.includes('--replace');
    if (replace) args.splice(args.indexOf('--replace'), 1);
    const makeDefault = args.includes('--default');
    if (makeDefault) args.splice(args.indexOf('--default'), 1);
    if (args.length) throw new Error(`Unknown arguments: ${args.join(' ')}`);
    if (!url) throw new Error('--url is required');
    validateConnection({ url, auth: { provider: 'env' } });
    if (!['webSocket', 'http'].includes(transport)) throw new Error('--transport must be webSocket or http');
    if (jarPath && command) throw new Error('Choose either --jar or --command, not both');
    if (!['file', 'env', 'keychain'].includes(provider))
        throw new Error('--auth-provider must be file, env, or keychain');

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
    await saveConnection(consumed.configPath, config, { profile: consumed.profile, replace, makeDefault });
    console.log(`Wrote non-secret Jenkins configuration to ${consumed.configPath}`);
    console.log(`Next: node scripts/jenkins.mjs${consumed.profile ? ` --profile ${consumed.profile}` : ''} whoami`);
}

main().catch((error) => {
    console.error(`Configuration failed: ${error.message}`);
    process.exit(1);
});
