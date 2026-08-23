import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { cliInvocation, isSensitiveName, jobApiPath } from '../scripts/lib/config.mjs';

const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const triggerScript = path.join(skillDir, 'scripts', 'trigger-build.mjs');

function runNode(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
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
