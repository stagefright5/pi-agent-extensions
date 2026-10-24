import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('skill uses the separately installed CLI and verifies its identity and supported version', async () => {
    const skill = await read('SKILL.md');
    assert.match(skill, /jenkins --version/);
    assert.match(skill, /@stagefright5\/jenkins-cli/);
    assert.match(skill, /0\.1\.x/);
    assert.match(skill, /npm install -g @stagefright5\/jenkins-cli@0\.1/);
    assert.match(skill, /Do not silently install, upgrade/);
    assert.match(skill, /fresh explicit confirmation/);
    assert.match(skill, /without classifying or enforcing mutation confirmation/);
    for (const path of ['SKILL.md', 'references/AUTHENTICATION.md', 'references/OPERATIONS.md']) {
        const text = await read(path);
        assert.doesNotMatch(text, /node scripts\/|node jenkins\.mjs/);
        assert.match(text, /jenkins --profile/);
    }
});
