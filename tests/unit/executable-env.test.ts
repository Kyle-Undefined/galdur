import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { resolveExecutable } from '../../src/services/executableResolver';
import { buildSpawnEnv } from '../../src/ui/terminal/spawnEnv';
import { TERM_ENV_VALUE } from '../../src/constants';
import { createTempDir, removeTempDir } from '../helpers/tempDir';

const testOnWindows = process.platform === 'win32' ? test : test.skip;

function setPathEnv(value: string): () => void {
    const originalPath = process.env.Path;
    const originalPATH = process.env.PATH;
    process.env.Path = value;
    process.env.PATH = value;
    return () => {
        if (originalPath === undefined) {
            delete process.env.Path;
        } else {
            process.env.Path = originalPath;
        }
        if (originalPATH === undefined) {
            delete process.env.PATH;
        } else {
            process.env.PATH = originalPATH;
        }
    };
}

testOnWindows(
    'resolveExecutable returns an env override when it is a quoted absolute path to an existing file',
    async () => {
        const tempDir = await createTempDir();
        const commandPath = join(tempDir, 'codex.exe');
        await writeFile(commandPath, '');
        const original = process.env.GALDUR_TEST_CMD;
        process.env.GALDUR_TEST_CMD = `"${commandPath}"`;

        try {
            const resolution = await resolveExecutable({
                overrideEnvVar: 'GALDUR_TEST_CMD',
                pathCandidates: ['codex.exe'],
                commonPathCandidates: [],
                fallbackCommand: 'codex',
            });

            assert.equal(resolution.command, commandPath);
            assert.equal(resolution.source, 'env:GALDUR_TEST_CMD');
            assert.equal(resolution.found, true);
            assert.deepEqual(resolution.attempts, [`GALDUR_TEST_CMD=${commandPath}`]);
        } finally {
            if (original === undefined) {
                delete process.env.GALDUR_TEST_CMD;
            } else {
                process.env.GALDUR_TEST_CMD = original;
            }
            await removeTempDir(tempDir);
        }
    }
);

testOnWindows('resolveExecutable returns an env override when it is a non-path command token', async () => {
    const original = process.env.GALDUR_TEST_CMD;
    process.env.GALDUR_TEST_CMD = 'custom-codex';

    try {
        const resolution = await resolveExecutable({
            overrideEnvVar: 'GALDUR_TEST_CMD',
            pathCandidates: ['codex.exe'],
            commonPathCandidates: [],
            fallbackCommand: 'codex',
        });

        assert.equal(resolution.command, 'custom-codex');
        assert.equal(resolution.source, 'env:GALDUR_TEST_CMD');
        assert.equal(resolution.found, true);
    } finally {
        if (original === undefined) {
            delete process.env.GALDUR_TEST_CMD;
        } else {
            process.env.GALDUR_TEST_CMD = original;
        }
    }
});

testOnWindows('resolveExecutable resolves from PATH when a matching command exists', async () => {
    const tempDir = await createTempDir();
    const uniqueName = `galdur-test-${Date.now()}-${Math.random().toString(16).slice(2)}.cmd`;
    const commandPath = join(tempDir, uniqueName);
    await writeFile(commandPath, '@echo off\r\n');
    const restorePath = setPathEnv(`${tempDir};C:\\Windows\\System32`);

    try {
        const resolution = await resolveExecutable({
            overrideEnvVar: 'GALDUR_TEST_CMD',
            pathCandidates: [uniqueName],
            commonPathCandidates: [],
            fallbackCommand: 'codex',
        });

        assert.equal(resolution.source, 'PATH');
        assert.equal(resolution.found, true);
        assert.equal(resolution.command.toLowerCase(), commandPath.toLowerCase());
        assert.deepEqual(resolution.attempts, [`where.exe ${uniqueName}`]);
    } finally {
        restorePath();
        await removeTempDir(tempDir);
    }
});

testOnWindows('resolveExecutable falls back to common path candidates when PATH lookup misses', async () => {
    const tempDir = await createTempDir();
    const commandPath = join(tempDir, 'codex.exe');
    await writeFile(commandPath, '');

    try {
        const resolution = await resolveExecutable({
            overrideEnvVar: 'GALDUR_TEST_CMD',
            pathCandidates: ['galdur-definitely-missing.cmd'],
            commonPathCandidates: [commandPath],
            fallbackCommand: 'codex',
        });

        assert.equal(resolution.command, commandPath);
        assert.equal(resolution.source, 'common-path');
        assert.equal(resolution.found, true);
        assert.deepEqual(resolution.attempts, ['where.exe galdur-definitely-missing.cmd', commandPath]);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('resolveExecutable returns the fallback command when nothing is found', async () => {
    const resolution = await resolveExecutable({
        overrideEnvVar: 'GALDUR_TEST_CMD',
        pathCandidates: ['galdur-definitely-missing.exe'],
        commonPathCandidates: [],
        fallbackCommand: 'codex',
    });

    assert.deepEqual(resolution, {
        command: 'codex',
        source: 'fallback',
        attempts: ['where.exe galdur-definitely-missing.exe'],
        found: false,
    });
});

testOnWindows('buildSpawnEnv sets TERM and prepends the executable directory to Path', async () => {
    const tempDir = await createTempDir();
    const commandPath = join(tempDir, 'codex.exe');

    try {
        const env = buildSpawnEnv(commandPath, { Path: 'C:\\Windows\\System32' });

        assert.equal(env.TERM, TERM_ENV_VALUE);
        assert.equal(env.Path, `${tempDir};C:\\Windows\\System32`);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('buildSpawnEnv does not duplicate the executable directory when it is already on Path', async () => {
    const tempDir = await createTempDir();
    const commandPath = join(tempDir, 'codex.exe');

    try {
        const env = buildSpawnEnv(commandPath, { Path: `"${tempDir}";C:\\Windows\\System32` });

        assert.equal(env.Path, `"${tempDir}";C:\\Windows\\System32`);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('buildSpawnEnv leaves PATH unchanged for non-absolute commands and preserves PATH casing', () => {
    const env = buildSpawnEnv('codex', { PATH: 'C:\\Windows\\System32' });

    assert.equal(env.TERM, TERM_ENV_VALUE);
    assert.equal(env.PATH, 'C:\\Windows\\System32');
    assert.equal(Object.prototype.hasOwnProperty.call(env, 'PATH'), true);
    assert.equal(Object.prototype.hasOwnProperty.call(env, 'Path'), false);
});
