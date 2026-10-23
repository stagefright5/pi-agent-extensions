import { createWriteStream } from 'node:fs';
import { link, lstat, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describeUrl, jenkinsGet, jobApiPath, readCredential } from './config.mjs';

const PERMALINKS = [
    'lastBuild',
    'lastCompletedBuild',
    'lastFailedBuild',
    'lastStableBuild',
    'lastSuccessfulBuild',
    'lastUnstableBuild',
    'lastUnsuccessfulBuild',
];

export function validateBuildId(build) {
    const value = String(build ?? '').trim();
    if (!/^[1-9][0-9]*$/.test(value) && !PERMALINKS.includes(value))
        throw new Error(`Build must be a positive number or one of: ${PERMALINKS.join(', ')}`);
    return value;
}

function buildPath(jobName, build) {
    return `${jobApiPath(jobName)}/${validateBuildId(build)}`;
}

// Artifact paths come from Jenkins or the command line; both are untrusted.
// Returns the normalized POSIX relative path, or throws if it could escape the output directory.
export function safeRelativePath(relativePath) {
    const value = String(relativePath ?? '');
    if (!value || value.includes('\0')) throw new Error('Artifact path must be a non-empty string');
    if (value.includes('\\')) throw new Error(`Artifact path must use / separators: ${JSON.stringify(value)}`);
    if (value.startsWith('/') || path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-zA-Z]:/.test(value))
        throw new Error(`Artifact path must be relative: ${JSON.stringify(value)}`);
    const segments = value.split('/');
    if (segments.includes('..')) throw new Error(`Artifact path must not contain '..': ${JSON.stringify(value)}`);
    const normalized = path.posix.normalize(value);
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.endsWith('/'))
        throw new Error(`Artifact path does not name a file: ${JSON.stringify(value)}`);
    return normalized;
}

export function resolveDestination(outDir, relativePath) {
    const root = path.resolve(outDir);
    const destination = path.resolve(root, ...safeRelativePath(relativePath).split('/'));
    const relative = path.relative(root, destination);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error(`Artifact path escapes the output directory: ${JSON.stringify(relativePath)}`);
    return destination;
}

export async function listArtifacts(config, jobName, build = 'lastSuccessfulBuild', credential) {
    credential ??= await readCredential(config);
    const tree = 'number,result,url,building,artifacts[fileName,relativePath]';
    const url = `${config.url}/${buildPath(jobName, build)}/api/json?tree=${encodeURIComponent(tree)}`;
    const response = await jenkinsGet(config, credential, url);
    if (!response.ok) throw new Error(`Jenkins returned HTTP ${response.status} for build ${build} of ${jobName}`);
    const data = await response.json();
    if (!Number.isInteger(data.number)) throw new Error(`Jenkins returned no build number for ${jobName} ${build}`);
    // Download from the configured controller URL, not the Jenkins-reported URL, so the origin check holds.
    const base = `${config.url}/${buildPath(jobName, data.number)}`;
    return {
        profile: config.profile,
        controller: config.url,
        job: jobName,
        build: data.number,
        result: data.result ?? null,
        building: data.building ?? false,
        url: data.url ?? `${base}/`,
        artifacts: (data.artifacts || []).map((artifact) => ({
            fileName: artifact.fileName,
            relativePath: artifact.relativePath,
            url: `${base}/artifact/${String(artifact.relativePath).split('/').map(encodeURIComponent).join('/')}`,
        })),
    };
}

function overwriteError(destination) {
    return new Error(`Refusing to overwrite ${destination}; pass --force to replace it`);
}

async function exists(filePath) {
    try {
        return await lstat(filePath);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

// Validate every destination before writing anything.
export async function planDownloads(listing, { outDir, selected = [], all = false, force = false }) {
    if (!outDir) throw new Error('--out DIR is required');
    if (all === Boolean(selected.length)) throw new Error('Specify either --all or one or more --artifact PATH');
    const byPath = new Map(listing.artifacts.map((artifact) => [artifact.relativePath, artifact]));
    let chosen;
    if (all) chosen = listing.artifacts;
    else {
        chosen = [];
        for (const requested of selected) {
            safeRelativePath(requested);
            const artifact = byPath.get(requested);
            if (!artifact)
                throw new Error(
                    `Build #${listing.build} has no artifact ${JSON.stringify(requested)}; use artifacts to list`,
                );
            if (!chosen.includes(artifact)) chosen.push(artifact);
        }
    }
    if (!chosen.length) throw new Error(`Build #${listing.build} has no archived artifacts`);
    const seen = new Set();
    const plan = [];
    for (const artifact of chosen) {
        const destination = resolveDestination(outDir, artifact.relativePath);
        if (seen.has(destination)) throw new Error(`Duplicate artifact destination: ${destination}`);
        seen.add(destination);
        const existing = await exists(destination);
        if (existing && !existing.isFile())
            throw new Error(`Destination exists and is not a regular file: ${destination}`);
        if (existing && !force) throw overwriteError(destination);
        plan.push({ ...artifact, destination });
    }
    return plan;
}

async function assertInside(root, directory) {
    const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)]);
    const relative = path.relative(realRoot, realDirectory);
    if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error(`Refusing to write through a link that leaves the output directory: ${directory}`);
}

async function placeFile(temporary, destination, force) {
    if (force) return rename(temporary, destination);
    try {
        // link() fails with EEXIST instead of replacing a file created after planning.
        await link(temporary, destination);
    } catch (error) {
        if (error.code === 'EEXIST') throw overwriteError(destination);
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
        if (await exists(destination)) throw overwriteError(destination);
        return rename(temporary, destination);
    }
    await unlink(temporary);
}

export async function downloadArtifact(config, credential, item, { outDir, force = false }) {
    const root = path.resolve(outDir);
    const directory = path.dirname(item.destination);
    await mkdir(directory, { recursive: true });
    await assertInside(root, directory);
    const response = await jenkinsGet(config, credential, item.url);
    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Jenkins returned HTTP ${response.status} for ${describeUrl(item.url)}`);
    }
    const suffix = randomBytes(6).toString('hex');
    const temporary = path.join(directory, `.${path.basename(item.destination)}.${suffix}.part`);
    let bytes = 0;
    try {
        const source = Readable.fromWeb(response.body);
        source.on('data', (chunk) => {
            bytes += chunk.length;
        });
        await pipeline(source, createWriteStream(temporary, { flags: 'wx', mode: 0o644 }));
        // fetch() decodes gzip/br bodies, so Content-Length (encoded size) only applies to identity responses.
        const encoding = (response.headers.get('content-encoding') || 'identity').trim().toLowerCase();
        const expected = encoding === 'identity' ? response.headers.get('content-length') : null;
        if (expected !== null && /^\d+$/.test(expected) && Number(expected) !== bytes)
            throw new Error(`Incomplete download of ${item.relativePath}: ${bytes} of ${expected} bytes`);
        await placeFile(temporary, item.destination, force);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
    return { relativePath: item.relativePath, path: item.destination, bytes };
}

export async function downloadArtifacts(config, jobName, build, options) {
    const credential = await readCredential(config);
    const listing = await listArtifacts(config, jobName, build, credential);
    await mkdir(path.resolve(options.outDir), { recursive: true });
    const plan = await planDownloads(listing, options);
    const files = [];
    for (const item of plan) files.push(await downloadArtifact(config, credential, item, options));
    return {
        profile: listing.profile,
        controller: listing.controller,
        job: listing.job,
        build: listing.build,
        result: listing.result,
        url: listing.url,
        outDir: path.resolve(options.outDir),
        files,
    };
}
