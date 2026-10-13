#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
    cliInvocation,
    consumeConfigArg,
    listProfiles,
    loadConfig,
    spawnInherited,
    withAuthFile,
} from './lib/config.mjs';

function usage() {
    console.log(`Usage:
  node jenkins.mjs [--config PATH] [--profile NAME] <command> [arguments]

Commands:
  profiles [--json]                 List safe connection metadata; no authentication
  configure [options]              Add a profile; configure --help shows provider options
  whoami                           Verify the selected credential
  jobs [FOLDER]                    List jobs at root or in a folder
  inspect JOB [--json]              Inspect job parameters
  build JOB [options]               Dry-run or trigger a build
  console JOB [BUILD]               Read console output
  cli -- COMMAND [arguments]       Advanced official CLI pass-through

Build options:
  --param NAME=VALUE (repeatable), --params-file PATH
  --dry-run, --follow, --verbose (requires --follow), --yes
  Agents must dry-run, present the summary, and get fresh confirmation before --yes.

Selection: --profile > JENKINS_SKILL_PROFILE > configured default > sole profile.
Unknown or ambiguous profiles fail. Credentials are never tried in sequence.
Legacy syntax remains supported: node jenkins.mjs [options] -- COMMAND [arguments].
Advanced/legacy pass-through does not enforce mutation confirmation; obtain it first.`);
}

async function runHelper(script, configPath, profile, args) {
    const globals = ['--config', configPath, ...(profile === undefined ? [] : ['--profile', profile])];
    return spawnInherited(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...globals, ...args]);
}

function requirePositionals(args, minimum, maximum, syntax) {
    if (args.length < minimum || args.length > maximum || args.some((arg) => !arg || arg.startsWith('-')))
        throw new Error(`Usage: ${syntax}`);
}

async function main() {
    const { configPath, profile, args } = consumeConfigArg(process.argv.slice(2));
    const command = args.shift();
    if (!command || ['--help', '-h', 'help'].includes(command)) return usage();
    let result;
    if (command === 'profiles') {
        if (args.length && (args.length !== 1 || args[0] !== '--json')) throw new Error('Usage: profiles [--json]');
        const listing = await listProfiles(configPath);
        if (args[0] === '--json') console.log(JSON.stringify(listing, null, 2));
        else {
            console.log(`Configuration: ${listing.configPath}`);
            if (listing.environmentProfile !== null)
                console.log(`Environment selection: ${listing.environmentProfile}`);
            for (const entry of listing.profiles) {
                console.log(
                    `${entry.name}${entry.name === listing.defaultProfile ? ' (default)' : ''}\t${entry.url}\t${entry.provider}${entry.userId ? ` (${entry.userId})` : ''}`,
                );
            }
            if (!listing.profiles.length) console.log('No profiles configured. Use configure --profile NAME.');
        }
        return;
    }
    if (command === 'configure') {
        result = await runHelper('./configure.mjs', configPath, profile, args);
    } else if (command === 'inspect' || command === 'build') {
        if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
            result = await runHelper(
                command === 'inspect' ? './inspect-job.mjs' : './trigger-build.mjs',
                configPath,
                profile,
                args,
            );
        } else {
            const job = args.shift();
            requirePositionals(job === undefined ? [] : [job], 1, 1, `${command} JOB [options]`);
            result = await runHelper(
                command === 'inspect' ? './inspect-job.mjs' : './trigger-build.mjs',
                configPath,
                profile,
                ['--job', job, ...args],
            );
        }
    } else {
        let cliArgs;
        if (command === '--') {
            cliArgs = args;
        } else if (command === 'cli') {
            if (args.shift() !== '--') throw new Error('Usage: cli -- COMMAND [arguments]');
            cliArgs = args;
        } else if (command === 'whoami') {
            requirePositionals(args, 0, 0, 'whoami');
            cliArgs = ['who-am-i'];
        } else if (command === 'jobs') {
            requirePositionals(args, 0, 1, 'jobs [FOLDER]');
            cliArgs = ['list-jobs', ...args];
        } else if (command === 'console') {
            requirePositionals(args, 1, 2, 'console JOB [BUILD]');
            cliArgs = ['console', ...args];
        } else {
            throw new Error(`Unknown command: ${command}; use --help or cli -- COMMAND for advanced operations`);
        }
        if (!cliArgs.length) throw new Error('A Jenkins CLI command is required after --');
        const config = await loadConfig(configPath, profile);
        result = await withAuthFile(config, async (authFile) => {
            const invocation = cliInvocation(config, authFile, cliArgs);
            return spawnInherited(invocation.command, invocation.args);
        });
    }
    if (result.signal) console.error(`Jenkins process terminated by signal ${result.signal}`);
    process.exitCode = result.code;
}

main().catch((error) => {
    console.error(`Jenkins CLI failed: ${error.message}`);
    process.exit(1);
});
