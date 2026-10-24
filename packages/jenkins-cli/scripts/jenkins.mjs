#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import {
    cliInvocation,
    consumeConfigArg,
    listProfiles,
    loadConfig,
    spawnInherited,
    withAuthFile,
} from './lib/config.mjs';
import { downloadArtifacts, listArtifacts } from './lib/artifacts.mjs';
import { commandHelp, hasHelp } from './lib/help.mjs';

function usage() {
    console.log(`Usage:
  jenkins [--config PATH] [--profile NAME] <command> [arguments]
  jenkins --version
  jenkins help [COMMAND]

Every command supports --help and -h (before any -- pass-through separator).

Commands:
  profiles [--json]                 List safe connection metadata; no authentication
  configure [options]              Add a profile; configure --help shows provider options
  whoami                           Verify the selected credential
  jobs [FOLDER]                    List jobs at root or in a folder
  inspect JOB [--json]              Inspect job parameters
  build JOB [options]               Dry-run or trigger a build
  console JOB [BUILD]               Read console output
  artifacts JOB [BUILD] [--json]    List archived artifacts (default build: lastSuccessfulBuild)
  download JOB BUILD [options]      Download archived artifacts to a local directory
  cli -- COMMAND [arguments]       Advanced official CLI pass-through

Read-only (no confirmation): profiles, whoami, jobs, inspect, console, artifacts, download.
Jenkins mutation (confirm first): build --yes, and any mutating cli -- COMMAND.

Build options:
  --param NAME=VALUE (repeatable), --params-file PATH
  --dry-run, --follow, --verbose (requires --follow), --yes
  Agents must dry-run, present the summary, and get fresh confirmation before --yes.

Download options:
  --out DIR (required), --artifact RELATIVE_PATH (repeatable) or --all, --force, --json
  BUILD is a number or permalink such as lastSuccessfulBuild. Relative paths are preserved under DIR;
  paths escaping DIR are rejected and existing files are kept unless --force is given.

Selection: --profile > JENKINS_SKILL_PROFILE > configured default > sole profile.
Unknown or ambiguous profiles fail. Credentials are never tried in sequence.
Legacy syntax remains supported: jenkins [options] -- COMMAND [arguments].
Advanced/legacy pass-through does not enforce mutation confirmation; obtain it first.`);
}

async function runHelper(script, configPath, profile, args) {
    const globals = ['--config', configPath, ...(profile === undefined ? [] : ['--profile', profile])];
    return spawnInherited(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...globals, ...args]);
}

function takeOption(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    const value = args[index + 1];
    args.splice(index, 2);
    if (args.includes(name)) throw new Error(`${name} may only be specified once`);
    return value;
}

function takeRepeated(args, name) {
    const values = [];
    while (args.includes(name)) {
        const index = args.indexOf(name);
        if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
        values.push(args[index + 1]);
        args.splice(index, 2);
    }
    return values;
}

function takeFlag(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return false;
    args.splice(index, 1);
    return true;
}

// Read-only REST commands: the credential is resolved in-process and never printed.
async function artifactsCommand(configPath, profile, args) {
    const json = takeFlag(args, '--json');
    requirePositionals(args, 1, 2, 'artifacts JOB [BUILD] [--json]');
    const config = await loadConfig(configPath, profile);
    const listing = await listArtifacts(config, args[0], args[1]);
    if (json) return console.log(JSON.stringify(listing, null, 2));
    console.log(`Profile: ${listing.profile}; controller: ${listing.controller}`);
    const status = listing.building ? 'BUILDING' : listing.result;
    console.log(`Job: ${listing.job}; build: #${listing.build}; result: ${status}`);
    console.log(`URL: ${listing.url}`);
    if (!listing.artifacts.length) console.log('Artifacts: none archived');
    else {
        console.log('Artifacts:');
        for (const artifact of listing.artifacts) console.log(`  - ${artifact.relativePath}`);
    }
}

async function downloadCommand(configPath, profile, args) {
    const json = takeFlag(args, '--json');
    const all = takeFlag(args, '--all');
    const force = takeFlag(args, '--force');
    const outDir = takeOption(args, '--out');
    const selected = takeRepeated(args, '--artifact');
    requirePositionals(args, 2, 2, 'download JOB BUILD (--artifact PATH ... | --all) --out DIR [--force] [--json]');
    if (!outDir) throw new Error('--out DIR is required');
    const config = await loadConfig(configPath, profile);
    const summary = await downloadArtifacts(config, args[0], args[1], { outDir, selected, all, force });
    if (json) return console.log(JSON.stringify(summary, null, 2));
    console.log(`Profile: ${summary.profile}; controller: ${summary.controller}`);
    console.log(`Job: ${summary.job}; build: #${summary.build}; result: ${summary.result}`);
    for (const file of summary.files) console.log(`Wrote ${file.path} (${file.bytes} bytes)`);
    const total = summary.files.reduce((sum, file) => sum + file.bytes, 0);
    console.log(`Downloaded ${summary.files.length} artifact(s), ${total} bytes, to ${summary.outDir}`);
}

function requirePositionals(args, minimum, maximum, syntax) {
    if (args.length < minimum || args.length > maximum || args.some((arg) => !arg || arg.startsWith('-')))
        throw new Error(`Usage: ${syntax}`);
}

async function main() {
    const { configPath, profile, args } = consumeConfigArg(process.argv.slice(2));
    const command = args.shift();
    if (!command || ['--help', '-h'].includes(command)) return usage();
    if (command === 'help') {
        if (!args.length || hasHelp(args)) return usage();
        requirePositionals(args, 1, 1, 'jenkins help [COMMAND]');
        return console.log(commandHelp(args[0]));
    }
    // Never intercept help after --: those arguments belong to the upstream CLI.
    if (command !== '--' && hasHelp(args)) return console.log(commandHelp(command));
    if (command === '--version' || command === '-v') {
        requirePositionals(args, 0, 0, '--version');
        const { name, version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
        console.log(`${name} ${version}`);
        return;
    }
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
    if (command === 'artifacts') return artifactsCommand(configPath, profile, args);
    if (command === 'download') return downloadCommand(configPath, profile, args);
    if (command === 'configure') {
        result = await runHelper('./configure.mjs', configPath, profile, args);
    } else if (command === 'inspect' || command === 'build') {
        const job = args.shift();
        requirePositionals(job === undefined ? [] : [job], 1, 1, `${command} JOB [options]`);
        result = await runHelper(
            command === 'inspect' ? './inspect-job.mjs' : './trigger-build.mjs',
            configPath,
            profile,
            ['--job', job, ...args],
        );
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
