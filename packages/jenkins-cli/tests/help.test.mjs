import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandHelp, hasHelp } from '../scripts/lib/help.mjs';

const entry = fileURLToPath(new URL('../scripts/jenkins.mjs', import.meta.url));
const commands = [
    'profiles',
    'configure',
    'whoami',
    'jobs',
    'inspect',
    'build',
    'console',
    'artifacts',
    'download',
    'cli',
];
const run = (args, env = {}, script = entry) =>
    spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, ...env },
    });

function assertHelp(result, expected) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /^Usage:/);
    if (expected) assert.equal(result.stdout.trim(), expected.trim());
}

test('root and every advertised command support local help without valid configuration', async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'jenkins-help-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const invalid = path.join(directory, 'invalid.json');
    await writeFile(invalid, 'not JSON');
    const env = { JENKINS_SKILL_CONFIG: invalid, JENKINS_SKILL_PROFILE: 'unknown' };
    const root = run(['--help'], env);
    assertHelp(root);
    assertHelp(run(['-h'], env), root.stdout);
    assertHelp(run(['help'], env), root.stdout);
    assertHelp(run(['help', '--help'], env), root.stdout);
    const advertised = [
        ...root.stdout
            .split('Commands:\n')[1]
            .split('\n\n')[0]
            .matchAll(/^  (\w+)/gm),
    ].map((match) => match[1]);
    assert.deepEqual(advertised, commands, 'new commands must be covered by the help matrix');
    for (const command of commands) {
        for (const args of [
            [command, '--help'],
            [command, '-h'],
            ['help', command],
        ]) {
            assertHelp(run(args, env), commandHelp(command));
            assertHelp(
                run(['--config', path.join(directory, 'missing.json'), '--profile', 'unknown', ...args], env),
                commandHelp(command),
            );
        }
    }
    assert.equal(await readFile(invalid, 'utf8'), 'not JSON');
});

test('command help works before or after arguments and bypasses execution validation', () => {
    const env = { JENKINS_SKILL_CONFIG: '/missing/jenkins-help-config.json', JENKINS_SKILL_PROFILE: 'unknown' };
    for (const args of [
        ['profiles', '--json', '--help'],
        ['configure', '--url', '--help'],
        ['inspect', '--help', 'Folder/Job'],
        ['inspect', 'Folder/Job', '-h'],
        ['build', '--help', 'Folder/Job', '--yes'],
        ['build', 'Folder/Job', '--yes', '--params-file', '/missing/params.json', '--help'],
        ['console', 'Folder/Job', '123', '--help'],
        ['download', 'Folder/Job', '123', '--force', '--help'],
        ['cli', '--help', '--', 'delete-job', 'Folder/Job'],
    ])
        assertHelp(run(args, env), commandHelp(args[0]));
});

test('legacy helpers share the public command help', () => {
    for (const [file, command] of [
        ['configure.mjs', 'configure'],
        ['inspect-job.mjs', 'inspect'],
        ['trigger-build.mjs', 'build'],
    ]) {
        const script = fileURLToPath(new URL(`../scripts/${file}`, import.meta.url));
        for (const flag of ['--help', '-h']) {
            assertHelp(run([flag], { JENKINS_SKILL_CONFIG: '/missing/config.json' }, script), commandHelp(command));
        }
    }
});

test('help detection respects the upstream separator and unknown help topics fail', () => {
    assert.equal(hasHelp(['--help', '--', 'build']), true);
    assert.equal(hasHelp(['--', 'build', '--help']), false);
    assert.equal(hasHelp(['--', '-h']), false);
    assert.equal(hasHelp(['--param', 'NAME=--help']), false);
    for (const command of ['profile', 'constructor', '__proto__']) {
        const result = run(['help', command]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Unknown command:/);
        assert.equal(result.stdout, '');
    }
});
