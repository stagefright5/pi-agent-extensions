#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import {
    cliInvocation,
    consumeConfigArg,
    inspectJob,
    isSensitiveName,
    loadConfig,
    parameterDefinitions,
    spawnInherited,
    withAuthFile,
} from './lib/config.mjs';

function usage() {
    console.log(`Usage:
  node trigger-build.mjs [--config PATH] --job JOB [parameters] [--follow] [--verbose] [--yes]

Parameters:
  --param NAME=VALUE          Repeatable non-secret parameter
  --params-file PATH          JSON object containing build parameters

Safety:
  Without --yes, type "trigger JOB" interactively. Agents may use --yes only after explicit user confirmation.`);
}

function takeOption(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1]) throw new Error(`${name} requires a value`);
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
}

function takeRepeated(args, name) {
    const values = [];
    for (;;) {
        const index = args.indexOf(name);
        if (index < 0) return values;
        if (!args[index + 1]) throw new Error(`${name} requires a value`);
        values.push(args[index + 1]);
        args.splice(index, 2);
    }
}

function takeFlag(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return false;
    args.splice(index, 1);
    return true;
}

function parseAssignment(value) {
    const index = value.indexOf('=');
    if (index <= 0) throw new Error(`Expected NAME=VALUE, got ${value}`);
    return [value.slice(0, index), value.slice(index + 1)];
}

async function readParamsFile(filePath) {
    if (!filePath) return {};
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error(`Parameter path is not a file: ${filePath}`);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
        console.warn(`Warning: parameter file ${filePath} is accessible by group/others; consider chmod 600`);
    }
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Parameter file must contain a JSON object');
    return parsed;
}

async function main() {
    const consumed = consumeConfigArg(process.argv.slice(2));
    const args = consumed.args;
    if (args.includes('--help') || args.includes('-h')) return usage();
    const jobName = takeOption(args, '--job');
    const paramsFile = takeOption(args, '--params-file');
    const assignments = takeRepeated(args, '--param');
    const follow = takeFlag(args, '--follow');
    const verbose = takeFlag(args, '--verbose');
    const yes = takeFlag(args, '--yes');
    if (args.length) throw new Error(`Unknown arguments: ${args.join(' ')}`);
    if (!jobName) throw new Error('--job is required');
    if (verbose && !follow) throw new Error('--verbose requires --follow');

    const parameters = { ...(await readParamsFile(paramsFile)) };
    for (const assignment of assignments) {
        const [name, value] = parseAssignment(assignment);
        parameters[name] = value;
    }
    for (const [name, value] of Object.entries(parameters)) {
        if (value == null || ['object', 'function', 'symbol'].includes(typeof value)) {
            throw new Error(`Parameter ${name} must be a string, number, or boolean`);
        }
        parameters[name] = String(value);
    }

    const config = await loadConfig(consumed.configPath);
    const job = await inspectJob(config, jobName);
    if (!job.buildable) throw new Error(`Job ${jobName} is not buildable`);
    const definitions = parameterDefinitions(job);
    const knownNames = new Set(definitions.map((definition) => definition.name));
    const unknown = Object.keys(parameters).filter((name) => !knownNames.has(name));
    if (unknown.length && definitions.length) throw new Error(`Unknown job parameter(s): ${unknown.join(', ')}`);

    console.log('Build mutation summary:');
    console.log(`  Job: ${jobName}`);
    console.log(`  URL: ${job.url}`);
    console.log(`  Mode: ${follow ? 'follow until completion' : 'queue and return'}${verbose ? ', stream console' : ''}`);
    console.log('  Parameters:');
    if (!Object.keys(parameters).length) console.log('    (defaults only)');
    for (const [name, value] of Object.entries(parameters)) {
        console.log(`    ${name}=${isSensitiveName(name) ? '[redacted]' : JSON.stringify(value)}`);
    }
    console.log('Reminder: ordinary Jenkins String/Text parameters are retained in build metadata; do not use them for secrets.');

    if (!yes) {
        if (!input.isTTY) throw new Error('Refusing non-interactive build without --yes; obtain explicit user confirmation first');
        const rl = readline.createInterface({ input, output });
        const expected = `trigger ${jobName}`;
        const answer = await rl.question(`Type ${JSON.stringify(expected)} to continue: `);
        rl.close();
        if (answer !== expected) throw new Error('Build confirmation did not match; nothing was triggered');
    }

    const buildArgs = ['build', jobName];
    for (const [name, value] of Object.entries(parameters)) buildArgs.push('-p', `${name}=${value}`);
    if (follow) buildArgs.push('-f');
    if (verbose) buildArgs.push('-v');

    const result = await withAuthFile(config, async (authFile) => {
        const invocation = cliInvocation(config, authFile, buildArgs);
        return spawnInherited(invocation.command, invocation.args);
    });
    if (result.signal) console.error(`Jenkins CLI terminated by signal ${result.signal}`);
    process.exitCode = result.code;
}

main().catch((error) => {
    console.error(`Build trigger failed: ${error.message}`);
    process.exit(1);
});
