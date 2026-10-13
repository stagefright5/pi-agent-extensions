import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    consumeConfigArg,
    listProfiles,
    loadConfig,
    normalizeConfig,
    validateConnection,
} from '../scripts/lib/config.mjs';
import { saveConnection } from '../scripts/lib/save-config.mjs';

const run = promisify(execFile);
const entry = fileURLToPath(new URL('../scripts/jenkins.mjs', import.meta.url));
const connection = { url: 'https://jenkins.example.com', auth: { provider: 'env' } };

async function fixture(t, document) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'jenkins-profiles-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const configPath = path.join(dir, 'config.json');
    if (document) await writeFile(configPath, JSON.stringify(document), { mode: 0o600 });
    return configPath;
}

// Avoid inheriting a developer's selected profile; restore it at the end of each test.
function isolateProfile(t, value) {
    const previous = process.env.JENKINS_SKILL_PROFILE;
    if (value === undefined) delete process.env.JENKINS_SKILL_PROFILE;
    else process.env.JENKINS_SKILL_PROFILE = value;
    t.after(() => {
        if (previous === undefined) delete process.env.JENKINS_SKILL_PROFILE;
        else process.env.JENKINS_SKILL_PROFILE = previous;
    });
}

test('selection precedence is explicit, environment, default, then sole profile', async (t) => {
    isolateProfile(t, 'env');
    const configPath = await fixture(t, {
        version: 2,
        defaultProfile: 'default',
        profiles: {
            default: connection,
            env: { ...connection, url: 'https://env.example.com' },
            explicit: { ...connection, url: 'https://explicit.example.com' },
        },
    });
    assert.equal((await loadConfig(configPath, 'explicit')).url, 'https://explicit.example.com');
    assert.equal((await loadConfig(configPath)).profile, 'env');
    delete process.env.JENKINS_SKILL_PROFILE;
    assert.equal((await loadConfig(configPath)).profile, 'default');
    await writeFile(configPath, JSON.stringify({ version: 2, profiles: { only: connection } }));
    assert.equal((await loadConfig(configPath)).profile, 'only');
    await assert.rejects(loadConfig(configPath, 'typo'), /Unknown Jenkins profile/);
    process.env.JENKINS_SKILL_PROFILE = 'typo';
    await assert.rejects(loadConfig(configPath), /Unknown Jenkins profile/);
});

test('ambiguous or empty profiles fail without choosing an identity', async (t) => {
    isolateProfile(t);
    const configPath = await fixture(t, { version: 2, profiles: { a: connection, b: connection } });
    await assert.rejects(loadConfig(configPath), /select one with --profile/);
    await writeFile(configPath, JSON.stringify({ version: 2, profiles: {} }));
    await assert.rejects(loadConfig(configPath), /select one with --profile/);
});

test('legacy reads do not migrate files; adding a profile preserves the old connection and default', async (t) => {
    isolateProfile(t);
    const configPath = await fixture(t, connection);
    const original = await readFile(configPath, 'utf8');
    assert.equal((await loadConfig(configPath)).profile, 'default');
    assert.equal(await readFile(configPath, 'utf8'), original);
    await saveConnection(configPath, { ...connection, url: 'https://second.example.com' }, { profile: 'second' });
    const document = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(document.version, 2);
    assert.deepEqual(document.profiles.default, connection);
    assert.equal(document.defaultProfile, 'default');
    assert.equal((await loadConfig(configPath, 'second')).url, 'https://second.example.com');
    await assert.rejects(saveConnection(configPath, connection), /Use --profile/);
    await assert.rejects(saveConnection(configPath, connection, { profile: 'second' }), /already exists/);
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')), document);
    await saveConnection(configPath, connection, { profile: 'second', replace: true, makeDefault: true });
    assert.equal((await loadConfig(configPath)).profile, 'second');
    if (process.platform !== 'win32') assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test('profile configuration CLI adds and replaces without erasing other profiles', async (t) => {
    const configPath = await fixture(t);
    const env = { ...process.env, JENKINS_SKILL_PROFILE: 'ignored-for-configure' };
    await run(
        process.execPath,
        [
            entry,
            '--config',
            configPath,
            'configure',
            '--profile',
            'reader',
            '--url',
            connection.url,
            '--auth-provider',
            'env',
            '--user-variable',
            'READER_USER',
            '--token-variable',
            'READER_TOKEN',
            '--default',
        ],
        { env },
    );
    await run(
        process.execPath,
        [
            entry,
            '--config',
            configPath,
            'configure',
            '--profile',
            'builder',
            '--url',
            connection.url,
            '--auth-provider',
            'keychain',
            '--user-id',
            'build-bot',
            '--service',
            'jenkins:builder',
        ],
        { env },
    );
    const document = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(document.defaultProfile, 'reader');
    assert.equal(document.profiles.reader.auth.tokenVariable, 'READER_TOKEN');
    assert.equal(document.profiles.builder.auth.service, 'jenkins:builder');
    await assert.rejects(
        run(
            process.execPath,
            [
                entry,
                '--config',
                configPath,
                'configure',
                '--profile',
                'builder',
                '--url',
                connection.url,
                '--auth-provider',
                'env',
            ],
            { env },
        ),
        /already exists/,
    );
    await run(
        process.execPath,
        [
            entry,
            '--config',
            configPath,
            'configure',
            '--profile',
            'builder',
            '--url',
            connection.url,
            '--auth-provider',
            'env',
            '--replace',
            '--default',
        ],
        { env },
    );
    const changed = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual(changed.profiles.reader, document.profiles.reader);
    assert.equal(changed.defaultProfile, 'builder');
});

test('invalid config and held writer lock are not overwritten', async (t) => {
    const configPath = await fixture(t);
    await writeFile(configPath, '{invalid sensitive-config-value');
    await assert.rejects(saveConnection(configPath, connection, { profile: 'new' }), (error) => {
        assert.match(error.message, /Invalid JSON/);
        assert.doesNotMatch(error.message, /sensitive-config-value/);
        return true;
    });
    assert.equal(await readFile(configPath, 'utf8'), '{invalid sensitive-config-value');
    await writeFile(`${configPath}.lock`, '');
    await assert.rejects(saveConnection(configPath, connection, { profile: 'new' }), /Configuration is locked/);
});

test('profile metadata never resolves or dumps credential provider fields', async (t) => {
    const configPath = await fixture(t, {
        version: 2,
        profiles: {
            file: { ...connection, auth: { provider: 'file', path: '/does/not/exist', token: 'not-to-be-printed' } },
            env: { ...connection, auth: { provider: 'env', tokenVariable: 'SECRET_VARIABLE' } },
            keychain: { ...connection, auth: { provider: 'keychain', userId: 'bot', service: 'private-service' } },
        },
    });
    const listing = await listProfiles(configPath);
    assert.equal(listing.profiles.length, 3);
    assert.doesNotMatch(JSON.stringify(listing), /not-to-be-printed|SECRET_VARIABLE|private-service|does\/not\/exist/);
});

test('wrapper options respect -- and reject missing or repeated values', () => {
    assert.deepEqual(consumeConfigArg(['--profile', 'reader', '--', 'help', '--profile', 'upstream']).args, [
        '--',
        'help',
        '--profile',
        'upstream',
    ]);
    assert.equal(consumeConfigArg(['--profile', 'reader', 'jobs']).profile, 'reader');
    for (const args of [['--profile'], ['--config', '--'], ['--profile', 'a', '--profile', 'b']])
        assert.throws(() => consumeConfigArg(args));
});

test('configuration rejects unsafe URLs, malformed profiles, and invalid defaults', () => {
    for (const url of [
        'https://user:token@jenkins.example.com',
        'http://localhost.evil.example',
        'https://jenkins.example.com/?token=secret',
    ])
        assert.throws(() => validateConnection({ ...connection, url }));
    assert.equal(
        validateConnection({ ...connection, url: 'http://localhost:8080/jenkins/' }).url,
        'http://localhost:8080/jenkins',
    );
    assert.throws(() => normalizeConfig({ version: 99, profiles: {} }), /version/);
    assert.throws(() => normalizeConfig({ version: 2, defaultProfile: 'missing', profiles: {} }), /defaultProfile/);
    assert.throws(() => normalizeConfig({ version: 2, profiles: { constructor: connection } }), /Profile names/);
});
