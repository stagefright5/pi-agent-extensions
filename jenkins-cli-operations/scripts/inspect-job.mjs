#!/usr/bin/env node
import { consumeConfigArg, inspectJob, isSensitiveName, loadConfig, parameterDefinitions } from './lib/config.mjs';

function usage() {
    console.log('Usage: node inspect-job.mjs [--config PATH] --job "Folder/Job Name" [--json]');
}

function takeOption(args, name) {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    if (!args[index + 1]) throw new Error(`${name} requires a value`);
    const value = args[index + 1];
    args.splice(index, 2);
    return value;
}

async function main() {
    const consumed = consumeConfigArg(process.argv.slice(2));
    const args = consumed.args;
    if (args.includes('--help') || args.includes('-h')) return usage();
    const jobName = takeOption(args, '--job');
    const json = args.includes('--json');
    if (json) args.splice(args.indexOf('--json'), 1);
    if (args.length) throw new Error(`Unknown arguments: ${args.join(' ')}`);
    if (!jobName) throw new Error('--job is required');

    const config = await loadConfig(consumed.configPath);
    const job = await inspectJob(config, jobName);
    const parameters = parameterDefinitions(job).map((definition) => ({
        name: definition.name,
        type: definition.type,
        description: definition.description || '',
        default: isSensitiveName(definition.name) || /password/i.test(definition.type)
            ? definition.defaultParameterValue?.value == null ? null : '[redacted]'
            : definition.defaultParameterValue?.value ?? null,
    }));
    const output = {
        name: job.name,
        url: job.url,
        buildable: job.buildable,
        inQueue: job.inQueue,
        nextBuildNumber: job.nextBuildNumber,
        parameters,
    };
    if (json) console.log(JSON.stringify(output, null, 2));
    else {
        console.log(`Job: ${output.name}`);
        console.log(`URL: ${output.url}`);
        console.log(`Buildable: ${output.buildable}; in queue: ${output.inQueue}; next build: ${output.nextBuildNumber}`);
        if (!parameters.length) console.log('Parameters: none declared');
        else {
            console.log('Parameters:');
            for (const parameter of parameters) {
                const defaultText = parameter.default == null ? '' : `; default=${JSON.stringify(parameter.default)}`;
                console.log(`  - ${parameter.name} (${parameter.type})${defaultText}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(`Job inspection failed: ${error.message}`);
    process.exit(1);
});
