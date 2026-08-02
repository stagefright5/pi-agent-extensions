#!/usr/bin/env node
import { cliInvocation, consumeConfigArg, loadConfig, spawnInherited, withAuthFile } from './lib/config.mjs';

function usage() {
    console.log(`Usage:
  node jenkins.mjs [--config PATH] -- <jenkins-cli command> [arguments...]

Examples:
  node jenkins.mjs -- who-am-i
  node jenkins.mjs -- list-jobs
  node jenkins.mjs -- help build`);
}

async function main() {
    const { configPath, args } = consumeConfigArg(process.argv.slice(2));
    if (args.includes('--help') && !args.includes('--')) return usage();
    const separator = args.indexOf('--');
    if (separator < 0 || separator === args.length - 1) {
        usage();
        throw new Error('Separate wrapper options from Jenkins CLI arguments with --');
    }
    const commandArgs = args.slice(separator + 1);
    const config = await loadConfig(configPath);
    const result = await withAuthFile(config, async (authFile) => {
        const invocation = cliInvocation(config, authFile, commandArgs);
        return spawnInherited(invocation.command, invocation.args);
    });
    if (result.signal) console.error(`Jenkins CLI terminated by signal ${result.signal}`);
    process.exitCode = result.code;
}

main().catch((error) => {
    console.error(`Jenkins CLI failed: ${error.message}`);
    process.exit(1);
});
