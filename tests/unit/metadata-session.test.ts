import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'fs/promises';
import { MetadataStore } from '../../src/services/runtime/MetadataStore';
import { Paths } from '../../src/services/runtime/Paths';
import { SessionManager } from '../../runtime/src/sessionManager';
import { MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS, TERM_ENV_VALUE } from '../../src/constants';
import { createTempDir, removeTempDir } from '../helpers/tempDir';
import type { RuntimeDataEvent, RuntimeExitEvent } from '../../shared/ipc-types';
import type { PtyModule, PtyProcess, TerminalExitEvent } from '../../runtime/src/types';
import type { VaultPaths } from '../../src/types';
import path from 'node:path';

const testOnWindows = process.platform === 'win32' ? test : test.skip;

function createVaultPaths(vaultPath: string): VaultPaths {
    return {
        vaultPath,
        configDir: path.join(vaultPath, '.obsidian'),
        pluginDir: path.join(vaultPath, '.obsidian', 'plugins', 'galdur'),
    };
}

testOnWindows('MetadataStore.read returns null when the metadata file does not exist', async () => {
    const tempDir = await createTempDir();
    const store = new MetadataStore(new Paths());

    try {
        const metadata = await store.read(createVaultPaths(tempDir));

        assert.equal(metadata, null);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('MetadataStore.read returns null for malformed JSON', async () => {
    const tempDir = await createTempDir();
    const paths = new Paths();
    const vaultPaths = createVaultPaths(tempDir);
    const metadataPath = paths.getVersionMetadataPath(vaultPaths);
    await mkdir(paths.getRuntimeInstallDir(vaultPaths), { recursive: true });
    await writeFile(metadataPath, '{not-json}', 'utf8');
    const store = new MetadataStore(paths);

    try {
        const metadata = await store.read(vaultPaths);

        assert.equal(metadata, null);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('MetadataStore.read returns null for invalid field types', async () => {
    const tempDir = await createTempDir();
    const paths = new Paths();
    const vaultPaths = createVaultPaths(tempDir);
    const metadataPath = paths.getVersionMetadataPath(vaultPaths);
    await mkdir(paths.getRuntimeInstallDir(vaultPaths), { recursive: true });
    await writeFile(metadataPath, JSON.stringify({ version: 123 }), 'utf8');
    const store = new MetadataStore(paths);

    try {
        const metadata = await store.read(vaultPaths);

        assert.equal(metadata, null);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('MetadataStore.write and read round-trip valid metadata', async () => {
    const tempDir = await createTempDir();
    const paths = new Paths();
    const vaultPaths = createVaultPaths(tempDir);
    await mkdir(paths.getRuntimeInstallDir(vaultPaths), { recursive: true });
    const store = new MetadataStore(paths);
    const expected = {
        version: '1.2.3',
        installedAt: '2026-03-07T10:00:00.000Z',
        runtimePath: 'C:\\vault\\.obsidian\\plugins\\galdur\\bin\\galdur-runtime.exe',
        sourcePath: 'C:\\downloads\\galdur-runtime.exe',
        localDevExe: true,
    };

    try {
        await store.write(vaultPaths, expected);
        const metadata = await store.read(vaultPaths);

        assert.deepEqual(metadata, expected);
    } finally {
        await removeTempDir(tempDir);
    }
});

testOnWindows('SessionManager spawns sessions, forwards data, writes, resizes, and kills active sessions', () => {
    const broadcasts: Array<RuntimeDataEvent | RuntimeExitEvent> = [];
    const fake = createFakePtyModule();
    const manager = new SessionManager(
        (event) => broadcasts.push(event),
        () => fake.module
    );

    const started = manager.spawn({
        command: 'claude',
        args: ['--model', 'sonnet'],
        cwd: 'C:\\vault',
        cols: 0.8,
        rows: Number.NaN,
        env: { PATH: 'C:\\Windows\\System32' },
    });

    assert.equal(typeof started.sessionId, 'string');
    assert.equal(started.pid, 321);
    assert.equal(fake.spawns.length, 1);
    assert.deepEqual(fake.spawns[0], {
        command: 'claude',
        args: ['--model', 'sonnet'],
        options: {
            name: TERM_ENV_VALUE,
            useConpty: false,
            cwd: 'C:\\vault',
            cols: MIN_TERMINAL_COLS,
            rows: MIN_TERMINAL_ROWS,
            env: { PATH: 'C:\\Windows\\System32' },
        },
    });

    manager.write({ sessionId: started.sessionId, data: 'hello' });
    manager.resize({ sessionId: started.sessionId, cols: 0, rows: 19.8 });
    fake.procState.dataListener?.('chunk');

    assert.deepEqual(fake.procState.writes, ['hello']);
    assert.deepEqual(fake.procState.resizes, [[MIN_TERMINAL_COLS, 19]]);
    assert.deepEqual(broadcasts, [
        {
            event: 'data',
            payload: { sessionId: started.sessionId, data: 'chunk' },
        },
    ]);

    manager.kill({ sessionId: started.sessionId });

    assert.equal(fake.procState.killCount, 1);
    assert.equal(fake.procState.disposeDataCount, 1);
    assert.equal(fake.procState.disposeExitCount, 1);
    assert.throws(() => manager.write({ sessionId: started.sessionId, data: 'again' }), /Session not found/);
});

testOnWindows('SessionManager broadcasts exits and disposes a session after the process exits', () => {
    const broadcasts: Array<RuntimeDataEvent | RuntimeExitEvent> = [];
    const fake = createFakePtyModule();
    const manager = new SessionManager(
        (event) => broadcasts.push(event),
        () => fake.module
    );
    const started = manager.spawn({
        command: 'codex',
        args: [],
        cwd: 'C:\\vault',
        cols: 120,
        rows: 40,
        env: {},
    });

    fake.procState.exitListener?.({ exitCode: 5, signal: 9 });

    assert.deepEqual(broadcasts, [
        {
            event: 'exit',
            payload: { sessionId: started.sessionId, event: { exitCode: 5, signal: 9 } },
        },
    ]);
    assert.equal(fake.procState.disposeDataCount, 1);
    assert.equal(fake.procState.disposeExitCount, 1);
    assert.throws(() => manager.resize({ sessionId: started.sessionId, cols: 80, rows: 24 }), /Session not found/);
});

testOnWindows('SessionManager.kill is a no-op for a missing session', () => {
    const fake = createFakePtyModule();
    const manager = new SessionManager(
        () => undefined,
        () => fake.module
    );

    manager.kill({ sessionId: 'missing' });

    assert.equal(fake.procState.killCount, 0);
});

testOnWindows('SessionManager.disposeAll kills every tracked session and clears them', () => {
    const fakeOne = createFakePtyModule(321);
    const fakeTwo = createFakePtyModule(654);
    let callCount = 0;
    const manager = new SessionManager(
        () => undefined,
        () => {
            callCount++;
            return callCount === 1 ? fakeOne.module : fakeTwo.module;
        }
    );

    const one = manager.spawn({
        command: 'one',
        args: [],
        cwd: 'C:\\vault',
        cols: 80,
        rows: 24,
        env: {},
    });
    const two = manager.spawn({
        command: 'two',
        args: [],
        cwd: 'C:\\vault',
        cols: 80,
        rows: 24,
        env: {},
    });

    manager.disposeAll();

    assert.equal(fakeOne.procState.killCount, 1);
    assert.equal(fakeTwo.procState.killCount, 1);
    assert.equal(fakeOne.procState.disposeDataCount, 1);
    assert.equal(fakeOne.procState.disposeExitCount, 1);
    assert.equal(fakeTwo.procState.disposeDataCount, 1);
    assert.equal(fakeTwo.procState.disposeExitCount, 1);
    assert.throws(() => manager.write({ sessionId: one.sessionId, data: 'x' }), /Session not found/);
    assert.throws(() => manager.write({ sessionId: two.sessionId, data: 'y' }), /Session not found/);
});

function createFakePtyModule(pid = 321): {
    module: PtyModule;
    procState: {
        dataListener?: (data: string) => void;
        exitListener?: (event: TerminalExitEvent) => void;
        writes: string[];
        resizes: Array<[number, number]>;
        killCount: number;
        disposeDataCount: number;
        disposeExitCount: number;
    };
    spawns: Array<{
        command: string;
        args: string[];
        options: {
            name: string;
            useConpty: boolean;
            cwd: string;
            cols: number;
            rows: number;
            env: NodeJS.ProcessEnv;
        };
    }>;
} {
    const procState: {
        dataListener?: (data: string) => void;
        exitListener?: (event: TerminalExitEvent) => void;
        writes: string[];
        resizes: Array<[number, number]>;
        killCount: number;
        disposeDataCount: number;
        disposeExitCount: number;
    } = {
        writes: [],
        resizes: [],
        killCount: 0,
        disposeDataCount: 0,
        disposeExitCount: 0,
    };
    const spawns: Array<{
        command: string;
        args: string[];
        options: {
            name: string;
            useConpty: boolean;
            cwd: string;
            cols: number;
            rows: number;
            env: NodeJS.ProcessEnv;
        };
    }> = [];

    const proc: PtyProcess = {
        pid,
        write(data) {
            procState.writes.push(data);
        },
        resize(cols, rows) {
            procState.resizes.push([cols, rows]);
        },
        kill() {
            procState.killCount++;
        },
        onData(listener) {
            procState.dataListener = listener;
            return {
                dispose() {
                    procState.disposeDataCount++;
                },
            };
        },
        onExit(listener) {
            procState.exitListener = listener;
            return {
                dispose() {
                    procState.disposeExitCount++;
                },
            };
        },
    };

    return {
        procState,
        spawns,
        module: {
            spawn(command, args, options) {
                spawns.push({ command, args, options });
                return proc;
            },
        },
    };
}
