import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveDestination, safeRelativePath, validateBuildId } from '../scripts/lib/artifacts.mjs';

const entryScript = fileURLToPath(new URL('../scripts/jenkins.mjs', import.meta.url));
const credential = 'artifact-user:artifact-token';
const basicAuth = `Basic ${Buffer.from(credential).toString('base64')}`;

function runNode(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entryScript, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, JENKINS_SKILL_PROFILE: undefined },
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
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}

async function listen(handler) {
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        handler(request, response);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return { server, requests, url: `http://127.0.0.1:${server.address().port}` };
}

const FILES = {
    'dist/app.zip': Buffer.from('PK\u0003\u0004 fake zip payload'),
    'report.txt': Buffer.from('report body\n'),
    'redirect/same.txt': Buffer.from('same-origin body'),
};

async function fakeJenkins(t, artifacts = Object.keys(FILES).concat('redirect/other.txt')) {
    // A different port is a different origin; it must never receive a request.
    const other = await listen((request, response) => response.writeHead(200).end('leaked'));
    const controller = await listen((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (request.headers.authorization !== basicAuth) return response.writeHead(401).end();
        const build = url.pathname.match(/^\/job\/Folder\/job\/Build\/(\d+|lastSuccessfulBuild)\/api\/json$/);
        if (build) {
            response.writeHead(200, { 'content-type': 'application/json' });
            return response.end(
                JSON.stringify({
                    number: 34,
                    result: 'SUCCESS',
                    url: `${controller.url}/job/Folder/job/Build/34/`,
                    artifacts: artifacts.map((relativePath) => ({
                        fileName: path.posix.basename(relativePath),
                        relativePath,
                    })),
                }),
            );
        }
        const prefix = '/job/Folder/job/Build/34/artifact/';
        if (url.pathname === `${prefix}redirect/same.txt`)
            return response.writeHead(302, { location: '/files/same.txt' }).end();
        if (url.pathname === `${prefix}redirect/other.txt`)
            return response.writeHead(302, { location: `${other.url}/stolen?sig=secret-signature` }).end();
        if (url.pathname === '/files/same.txt') return response.writeHead(200).end(FILES['redirect/same.txt']);
        const relativePath = decodeURIComponent(url.pathname.slice(prefix.length));
        if (url.pathname.startsWith(prefix) && FILES[relativePath]) {
            response.writeHead(200, { 'content-length': FILES[relativePath].length });
            return response.end(FILES[relativePath]);
        }
        response.writeHead(404).end();
    });
    const dir = await mkdtemp(path.join(os.tmpdir(), 'jenkins-artifacts-test-'));
    const authPath = path.join(dir, 'auth');
    const configPath = path.join(dir, 'config.json');
    await writeFile(authPath, credential, { mode: 0o600 });
    if (process.platform !== 'win32') await chmod(authPath, 0o600);
    await writeFile(configPath, JSON.stringify({ url: controller.url, auth: { provider: 'file', path: authPath } }));
    t.after(async () => {
        await Promise.all([controller, other].map(({ server }) => new Promise((resolve) => server.close(resolve))));
        await rm(dir, { recursive: true, force: true });
    });
    return { dir, configPath, controller, other, out: path.join(dir, 'out') };
}

function assertNoSecrets(result) {
    const text = result.stdout + result.stderr;
    assert.doesNotMatch(text, /artifact-token|secret-signature/);
    assert.ok(!text.includes(Buffer.from(credential).toString('base64')));
}

test('artifact paths reject traversal, absolute, and malformed paths', () => {
    const badPaths = [
        '../x',
        'a/../../x',
        'a/..',
        '/etc/passwd',
        'C:/x',
        'c:x',
        'a\\b',
        '\\\\server\\x',
        '',
        'a/',
        '.',
    ];
    for (const bad of badPaths) assert.throws(() => safeRelativePath(bad), undefined, bad);
    assert.equal(safeRelativePath('a/./b//c.zip'), 'a/b/c.zip');
    const out = path.resolve('/tmp/out');
    assert.equal(resolveDestination(out, 'dist/app.zip'), path.join(out, 'dist', 'app.zip'));
    assert.throws(() => resolveDestination(out, '../out-sibling/x'));
    assert.equal(validateBuildId('35'), '35');
    assert.equal(validateBuildId('lastSuccessfulBuild'), 'lastSuccessfulBuild');
    for (const bad of ['0', '-1', '1/../2', 'lastBuild/x', ''])
        assert.throws(() => validateBuildId(bad), undefined, bad);
});

test('artifacts lists the default lastSuccessfulBuild with credentials kept in-process', async (t) => {
    const fixture = await fakeJenkins(t);
    const result = await runNode(['--config', fixture.configPath, 'artifacts', 'Folder/Build', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const listing = JSON.parse(result.stdout);
    assert.equal(listing.profile, 'default');
    assert.equal(listing.build, 34);
    assert.equal(listing.result, 'SUCCESS');
    assert.deepEqual(
        listing.artifacts.map((artifact) => artifact.relativePath),
        ['dist/app.zip', 'report.txt', 'redirect/same.txt', 'redirect/other.txt'],
    );
    assert.equal(listing.artifacts[0].url, `${fixture.controller.url}/job/Folder/job/Build/34/artifact/dist/app.zip`);
    assert.match(fixture.controller.requests[0].url, /^\/job\/Folder\/job\/Build\/lastSuccessfulBuild\/api\/json\?/);
    assertNoSecrets(result);

    const text = await runNode(['--config', fixture.configPath, 'artifacts', 'Folder/Build', '34']);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /build: #34; result: SUCCESS/);
    assert.match(text.stdout, / {2}- dist\/app\.zip/);
});

test('download writes selected artifacts with preserved paths and refuses overwrites without --force', async (t) => {
    const fixture = await fakeJenkins(t);
    const args = ['--config', fixture.configPath, 'download', 'Folder/Build', '34', '--out', fixture.out];
    const first = await runNode([...args, '--artifact', 'dist/app.zip', '--artifact', 'report.txt', '--json']);
    assert.equal(first.code, 0, first.stderr);
    const summary = JSON.parse(first.stdout);
    assert.deepEqual(
        summary.files.map(({ relativePath, bytes }) => [relativePath, bytes]),
        [
            ['dist/app.zip', FILES['dist/app.zip'].length],
            ['report.txt', FILES['report.txt'].length],
        ],
    );
    assert.equal(summary.files[0].path, path.join(fixture.out, 'dist', 'app.zip'));
    assert.deepEqual(await readFile(path.join(fixture.out, 'dist', 'app.zip')), FILES['dist/app.zip']);
    assert.deepEqual((await readdir(path.join(fixture.out, 'dist'))).sort(), ['app.zip'], 'no temp files remain');
    assertNoSecrets(first);

    await writeFile(path.join(fixture.out, 'report.txt'), 'local edits');
    const requestsBefore = fixture.controller.requests.length;
    const refused = await runNode([...args, '--artifact', 'dist/app.zip', '--artifact', 'report.txt']);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /Refusing to overwrite .*app\.zip; pass --force/);
    assert.equal(await readFile(path.join(fixture.out, 'report.txt'), 'utf8'), 'local edits');
    assert.equal(fixture.controller.requests.length, requestsBefore + 1, 'only the listing was fetched');

    const forced = await runNode([...args, '--artifact', 'report.txt', '--force']);
    assert.equal(forced.code, 0, forced.stderr);
    assert.match(forced.stdout, /Wrote .*report\.txt \(12 bytes\)/);
    assert.deepEqual(await readFile(path.join(fixture.out, 'report.txt')), FILES['report.txt']);

    const unknown = await runNode([...args, '--artifact', 'missing.zip']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /has no artifact "missing\.zip"/);
    const neither = await runNode(args);
    assert.equal(neither.code, 1);
    assert.match(neither.stderr, /either --all or one or more --artifact/);
});

test('download rejects traversal from the command line and from Jenkins before writing anything', async (t) => {
    const fixture = await fakeJenkins(t, ['report.txt', '../escape.txt', '/abs/evil.txt']);
    const args = ['--config', fixture.configPath, 'download', 'Folder/Build', '34', '--out', fixture.out];
    const cli = await runNode([...args, '--artifact', '../escape.txt']);
    assert.equal(cli.code, 1);
    assert.match(cli.stderr, /must not contain '\.\.'/);
    const all = await runNode([...args, '--all']);
    assert.equal(all.code, 1);
    assert.match(all.stderr, /must not contain '\.\.'/);
    assert.deepEqual(await readdir(fixture.out), [], 'nothing written, not even the valid artifact');
    await assert.rejects(readFile(path.join(fixture.dir, 'escape.txt')), { code: 'ENOENT' });
    assert.ok(fixture.controller.requests.every((request) => !request.url.includes('/artifact/')));
});

const posixOnly = { skip: process.platform === 'win32' };

test('download refuses to write through a symlink that leaves the output directory', posixOnly, async (t) => {
    const fixture = await fakeJenkins(t);
    const outside = path.join(fixture.dir, 'outside');
    await mkdir(outside);
    await mkdir(fixture.out);
    await symlink(outside, path.join(fixture.out, 'dist'));
    const result = await runNode([
        '--config',
        fixture.configPath,
        'download',
        'Folder/Build',
        '34',
        '--out',
        fixture.out,
        '--artifact',
        'dist/app.zip',
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /link that leaves the output directory/);
    assert.deepEqual(await readdir(outside), []);
});

test('redirects keep credentials on the controller origin', async (t) => {
    const fixture = await fakeJenkins(t);
    const args = ['--config', fixture.configPath, 'download', 'Folder/Build', '34', '--out', fixture.out];
    const same = await runNode([...args, '--artifact', 'redirect/same.txt']);
    assert.equal(same.code, 0, same.stderr);
    assert.deepEqual(await readFile(path.join(fixture.out, 'redirect', 'same.txt')), FILES['redirect/same.txt']);
    const followed = fixture.controller.requests.find((request) => request.url === '/files/same.txt');
    assert.equal(followed?.authorization, basicAuth);

    const cross = await runNode([...args, '--artifact', 'redirect/other.txt']);
    assert.equal(cross.code, 1);
    assert.match(cross.stderr, /Refusing cross-origin redirect/);
    assert.equal(fixture.other.requests.length, 0, 'the other origin must not be contacted');
    await assert.rejects(readFile(path.join(fixture.out, 'redirect', 'other.txt')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(path.join(fixture.out, 'redirect'))).sort(), ['same.txt']);
    assertNoSecrets(cross);
});
