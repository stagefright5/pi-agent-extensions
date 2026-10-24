import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cliInvocation, isSensitiveName, jobApiPath } from '../scripts/lib/config.mjs';

const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const triggerScript = path.join(skillDir, 'scripts', 'trigger-build.mjs');

function runNode(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, JENKINS_SKILL_PROFILE: undefined, ...env },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
}

async function fakeJenkins(t, overrides = {}) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'jenkins-cli-operations-test-'));
    const authPath = path.join(tempDir, 'auth');
    const configPath = path.join(tempDir, 'config.json');
    const credential = 'test-user:test-token';
    await writeFile(authPath, credential, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(authPath, 0o600);

    const requests = [];
    let controllerUrl;
    const job = {
        name: 'Build',
        url: 'http://invalid-before-listen',
        buildable: true,
        inQueue: false,
        nextBuildNumber: 42,
        property: [
            {
                parameterDefinitions: [
                    {
                        name: 'BRANCH',
                        type: 'StringParameterDefinition',
                        description: 'Git branch',
                        defaultParameterValue: { value: 'main' },
                    },
                ],
            },
        ],
        ...overrides,
    };

    const server = http.createServer((request, response) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        if (!request.url?.startsWith('/job/Folder/job/Build/api/json?')) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ...job, url: `${controllerUrl}/job/Folder/job/Build/` }));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    controllerUrl = `http://127.0.0.1:${address.port}`;

    await writeFile(
        configPath,
        `${JSON.stringify(
            {
                url: controllerUrl,
                transport: 'webSocket',
                command: 'this-launcher-must-not-run-during-dry-run',
                auth: { provider: 'file', path: authPath },
            },
            null,
            2,
        )}\n`,
        { mode: 0o600 },
    );

    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await rm(tempDir, { recursive: true, force: true });
    });

    return { authPath, configPath, controllerUrl, credential, requests };
}

test('job paths encode each full-name segment', () => {
    assert.equal(jobApiPath(' Folder / Feature%2Fwork '), 'job/Folder/job/Feature%252Fwork');
    assert.throws(() => jobApiPath(' / '), /must not be empty/);
});

test('sensitive-name detection covers common credential labels', () => {
    for (const name of ['PASSWORD', 'API_TOKEN', 'client_secret', 'AUTH_HEADER', 'PRIVATE_KEY']) {
        assert.equal(isSensitiveName(name), true, name);
    }
    assert.equal(isSensitiveName('BRANCH'), false);
});

test('generic CLI invocation passes arbitrary upstream commands through', () => {
    const invocation = cliInvocation(
        { url: 'https://jenkins.example.com', transport: 'webSocket', command: 'jenkins-cli' },
        '/tmp/jenkins-auth',
        ['groovy', '='],
    );
    assert.equal(invocation.command, 'jenkins-cli');
    assert.deepEqual(invocation.args, [
        '-s',
        'https://jenkins.example.com',
        '-webSocket',
        '-auth',
        '@/tmp/jenkins-auth',
        'groovy',
        '=',
    ]);
});

test('build dry-run inspects and summarizes without invoking the CLI', async (t) => {
    const fixture = await fakeJenkins(t);
    const result = await runNode([
        triggerScript,
        '--config',
        fixture.configPath,
        '--job',
        'Folder/Build',
        '--param',
        'BRANCH=release',
        '--follow',
        '--verbose',
        '--dry-run',
        '--yes',
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /Build execution summary:/);
    assert.match(
        result.stdout,
        new RegExp(`Controller: ${fixture.controllerUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
    assert.match(result.stdout, /Buildable: true; in queue: false; next build: 42/);
    assert.match(result.stdout, /Action: dry run; do not queue/);
    assert.match(result.stdout, /Mode: follow until completion, stream console/);
    assert.match(result.stdout, /BRANCH="release"/);
    assert.match(result.stdout, /Dry run complete; no build was queued\./);
    assert.equal(result.stderr, '');
    assert.equal(fixture.requests.length, 1);
    assert.match(fixture.requests[0].url, /^\/job\/Folder\/job\/Build\/api\/json\?tree=/);
    assert.equal(fixture.requests[0].authorization, `Basic ${Buffer.from(fixture.credential).toString('base64')}`);
});

test('dry-run rejects unknown declared-job parameters', async (t) => {
    const fixture = await fakeJenkins(t);
    const result = await runNode([
        triggerScript,
        '--config',
        fixture.configPath,
        '--job',
        'Folder/Build',
        '--param',
        'UNKNOWN=value',
        '--dry-run',
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Unknown job parameter\(s\): UNKNOWN/);
    assert.doesNotMatch(result.stdout, /Dry run complete/);
});

test('non-interactive execution still requires --yes', async (t) => {
    const fixture = await fakeJenkins(t);
    const result = await runNode([
        triggerScript,
        '--config',
        fixture.configPath,
        '--job',
        'Folder/Build',
        '--param',
        'BRANCH=main',
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /Action: queue build/);
    assert.match(result.stderr, /Refusing non-interactive build without --yes/);
});

test('dry-run rejects a non-buildable job', async (t) => {
    const fixture = await fakeJenkins(t, { buildable: false });
    const result = await runNode([triggerScript, '--config', fixture.configPath, '--job', 'Folder/Build', '--dry-run']);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Job Folder\/Build is not buildable/);
});

const entryScript = path.join(skillDir, 'scripts', 'jenkins.mjs');

test('version identifies the package without reading configuration or credentials', async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'jenkins-version-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const config = path.join(directory, 'invalid.json');
    await writeFile(config, 'not JSON');
    const manifest = JSON.parse(await readFile(path.join(skillDir, 'package.json'), 'utf8'));
    for (const flag of ['--version', '-v']) {
        const result = await runNode([entryScript, '--config', config, '--profile', 'unknown', flag]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.stdout.trim(), `${manifest.name} ${manifest.version}`);
        assert.equal(result.stderr, '');
    }
    const invalid = await runNode([entryScript, '--version', 'unexpected']);
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /Usage: --version/);
});

test('unified build selects credentials on the same controller and reports the profile', async (t) => {
    const fixture = await fakeJenkins(t);
    const connection = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    await writeFile(
        fixture.configPath,
        JSON.stringify({
            version: 2,
            defaultProfile: 'reader',
            profiles: {
                reader: connection,
                builder: {
                    ...connection,
                    auth: { provider: 'env', userVariable: 'TEST_JENKINS_USER', tokenVariable: 'TEST_JENKINS_TOKEN' },
                },
            },
        }),
    );
    const result = await runNode(
        [
            entryScript,
            '--config',
            fixture.configPath,
            '--profile',
            'builder',
            'build',
            'Folder/Build',
            '--param',
            'BRANCH=release',
            '--follow',
            '--dry-run',
        ],
        { TEST_JENKINS_USER: 'builder', TEST_JENKINS_TOKEN: 'second-token' },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Profile: builder/);
    assert.match(result.stdout, /Authentication: env/);
    assert.match(result.stdout, /BRANCH="release"/);
    assert.doesNotMatch(result.stdout + result.stderr, /second-token|test-token/);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].authorization, `Basic ${Buffer.from('builder:second-token').toString('base64')}`);

    const denied = await runNode(
        [entryScript, '--config', fixture.configPath, '--profile', 'builder', 'build', 'Folder/Build'],
        { TEST_JENKINS_USER: 'builder', TEST_JENKINS_TOKEN: 'second-token' },
    );
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /Refusing non-interactive build without --yes/);

    const missing = await runNode([
        entryScript,
        '--config',
        fixture.configPath,
        '--profile',
        'typo',
        'inspect',
        'Folder/Build',
    ]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /Unknown Jenkins profile/);
    assert.equal(fixture.requests.length, 2);
    const unavailable = await runNode(
        [entryScript, '--config', fixture.configPath, '--profile', 'builder', 'inspect', 'Folder/Build'],
        { TEST_JENKINS_USER: undefined, TEST_JENKINS_TOKEN: undefined },
    );
    assert.equal(unavailable.code, 1);
    assert.match(unavailable.stderr, /Environment auth requires/);
    assert.equal(fixture.requests.length, 2, 'must not retry with the reader credential');
});

test('unified inspect and profile discovery remain read-only and credential-safe', async (t) => {
    const fixture = await fakeJenkins(t);
    const inspection = await runNode([
        entryScript,
        '--config',
        fixture.configPath,
        'inspect',
        'Folder/Build',
        '--json',
    ]);
    assert.equal(inspection.code, 0, inspection.stderr);
    assert.equal(JSON.parse(inspection.stdout).profile, 'default');
    await rm(fixture.authPath);
    const listing = await runNode([entryScript, '--config', fixture.configPath, 'profiles', '--json']);
    assert.equal(listing.code, 0, listing.stderr);
    assert.deepEqual(JSON.parse(listing.stdout).profiles, [
        { name: 'default', url: fixture.controllerUrl, provider: 'file' },
    ]);
    assert.doesNotMatch(listing.stdout, /test-token|test-user/);
    assert.equal(fixture.requests.length, 1);
});

test(
    'unified interface routes known read-only commands and preserves raw CLI arguments',
    { skip: process.platform === 'win32' },
    async (t) => {
        const fixture = await fakeJenkins(t);
        const launcher = path.join(path.dirname(fixture.configPath), 'fake-cli');
        await writeFile(launcher, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', {
            mode: 0o700,
        });
        const connection = JSON.parse(await readFile(fixture.configPath, 'utf8'));
        connection.command = launcher;
        await writeFile(fixture.configPath, JSON.stringify(connection));
        for (const [args, expected] of [
            [['whoami'], ['who-am-i']],
            [['cli', '--', '--version'], ['--version']],
            [
                ['jobs', 'Folder Name'],
                ['list-jobs', 'Folder Name'],
            ],
            [
                ['console', 'Folder/Build', '42'],
                ['console', 'Folder/Build', '42'],
            ],
            [
                ['--', 'help', '--config', 'upstream', '--profile', 'upstream'],
                ['help', '--config', 'upstream', '--profile', 'upstream'],
            ],
            [
                ['cli', '--', 'help', 'build'],
                ['help', 'build'],
            ],
        ]) {
            const result = await runNode([entryScript, '--config', fixture.configPath, ...args]);
            assert.equal(result.code, 0, result.stderr);
            assert.deepEqual(JSON.parse(result.stdout).slice(5), expected);
        }
        const unknown = await runNode([entryScript, '--config', fixture.configPath, 'groovy', '=']);
        assert.equal(unknown.code, 1);
        assert.match(unknown.stderr, /Unknown command/);
    },
);

test(
    'confirmed build passes the selected credential and execution options to a local fake CLI',
    { skip: process.platform === 'win32' },
    async (t) => {
        const fixture = await fakeJenkins(t);
        const launcher = path.join(path.dirname(fixture.configPath), 'fake-build-cli');
        await writeFile(
            launcher,
            `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const authFile = args[args.indexOf('-auth') + 1].slice(1);
if (fs.readFileSync(authFile, 'utf8') !== 'builder:build-token') process.exit(42);
console.log(JSON.stringify(args));
`,
            { mode: 0o700 },
        );
        const connection = JSON.parse(await readFile(fixture.configPath, 'utf8'));
        await writeFile(
            fixture.configPath,
            JSON.stringify({
                version: 2,
                defaultProfile: 'reader',
                profiles: {
                    reader: connection,
                    builder: {
                        ...connection,
                        command: launcher,
                        auth: { provider: 'env', userVariable: 'TEST_BUILD_USER', tokenVariable: 'TEST_BUILD_TOKEN' },
                    },
                },
            }),
        );
        const result = await runNode(
            [
                entryScript,
                '--config',
                fixture.configPath,
                '--profile',
                'builder',
                'build',
                'Folder/Build',
                '--param',
                'BRANCH=release',
                '--follow',
                '--verbose',
                '--yes',
            ],
            { TEST_BUILD_USER: 'builder', TEST_BUILD_TOKEN: 'build-token' },
        );
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /Profile: builder/);
        assert.doesNotMatch(result.stdout + result.stderr, /build-token/);
        const args = JSON.parse(result.stdout.trim().split('\n').at(-1));
        assert.deepEqual(args.slice(5), ['build', 'Folder/Build', '-p', 'BRANCH=release', '-f', '-v']);
        assert.equal(args[1], fixture.controllerUrl);
        await assert.rejects(readFile(args[4].slice(1)), { code: 'ENOENT' });
        assert.equal(
            fixture.requests[0].authorization,
            `Basic ${Buffer.from('builder:build-token').toString('base64')}`,
        );
    },
);
