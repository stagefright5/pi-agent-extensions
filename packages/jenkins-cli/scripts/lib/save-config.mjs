import { chmod, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeConfig, readConfigDocument, validateConnection, validateProfileName } from './config.mjs';

// Serialize read/modify/write and atomically replace the metadata file. No tokens are stored here.
export async function saveConnection(configPath, connection, { profile, replace = false, makeDefault = false } = {}) {
    connection = validateConnection(connection);
    if (profile !== undefined) validateProfileName(profile);
    if (!profile && (replace || makeDefault)) throw new Error('--replace and --default require --profile');
    await mkdir(path.dirname(configPath), { recursive: true });
    const lockPath = `${configPath}.lock`;
    let lock;
    try {
        lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
        if (error.code === 'EEXIST')
            throw new Error(
                `Configuration is locked: ${lockPath}; retry or remove a stale lock after verifying no writer is running`,
            );
        throw error;
    }
    const temporary = `${configPath}.${randomUUID()}.tmp`;
    try {
        let previous;
        try {
            previous = await readConfigDocument(configPath);
        } catch (error) {
            if (error.cause?.code !== 'ENOENT') throw error;
        }
        let document;
        if (!profile) {
            if (previous && Object.hasOwn(previous, 'profiles'))
                throw new Error('Use --profile NAME to configure a profile; existing profiles were not changed');
            document = connection; // Preserve legacy configure behavior for single-connection files.
        } else {
            document = previous ? normalizeConfig(previous) : { version: 2, profiles: {} };
            if (Object.hasOwn(document.profiles, profile) && !replace)
                throw new Error(`Profile ${profile} already exists; use --replace to replace it`);
            document.profiles[profile] = connection;
            if (makeDefault) document.defaultProfile = profile;
        }
        await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        if (process.platform !== 'win32') await chmod(temporary, 0o600);
        await rename(temporary, configPath);
    } finally {
        await rm(temporary, { force: true });
        await lock.close();
        await rm(lockPath, { force: true });
    }
}
