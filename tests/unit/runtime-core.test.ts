import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { DEFAULT_SETTINGS, RUNTIME_AUTH_TOKEN_ENV_VAR, RUNTIME_PROTOCOL_VERSION } from '../../src/constants';
import { createRequest } from '../../src/services/runtime/createRequest';
import { parseArgs } from '../../runtime/src/args';
import { Paths } from '../../src/services/runtime/Paths';
import type { VaultPaths } from '../../src/types';
import {
    createEmptyPayloadResponse,
    isResponsePayloadForType,
    isRuntimeEvent,
    parseRuntimeSpawnPayload,
} from '../../shared/ipc-codecs';

const testOnWindows = process.platform === 'win32' ? test : test.skip;

function createVaultPaths(): VaultPaths {
    return {
        vaultPath: 'C:\\vault',
        configDir: '.obsidian',
        pluginDir: 'C:\\vault\\.obsidian\\plugins\\galdur',
    };
}

test('createRequest includes the id, auth token, payload, type, and protocol version', () => {
    const request = createRequest('req-1', 'token-123', 'spawn', {
        command: 'claude',
        args: ['--model', 'sonnet'],
        cwd: 'C:\\vault',
        cols: 80,
        rows: 24,
        env: { TERM: 'xterm-256color' },
    });

    assert.deepEqual(request, {
        id: 'req-1',
        authToken: 'token-123',
        type: 'spawn',
        payload: {
            command: 'claude',
            args: ['--model', 'sonnet'],
            cwd: 'C:\\vault',
            cols: 80,
            rows: 24,
            env: { TERM: 'xterm-256color' },
        },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
    });
});

test('parseArgs reads explicit CLI flags and the auth token from the environment', () => {
    const original = process.env[RUNTIME_AUTH_TOKEN_ENV_VAR];
    process.env[RUNTIME_AUTH_TOKEN_ENV_VAR] = 'token-abc';

    try {
        const parsed = parseArgs([
            '--pipe-path',
            '\\\\.\\pipe\\galdur-test',
            '--protocol-version',
            '7',
            '--version',
            '--healthcheck',
        ]);

        assert.deepEqual(parsed, {
            pipePath: '\\\\.\\pipe\\galdur-test',
            authToken: 'token-abc',
            protocolVersion: 7,
            version: true,
            healthcheck: true,
        });
    } finally {
        if (original === undefined) {
            delete process.env[RUNTIME_AUTH_TOKEN_ENV_VAR];
        } else {
            process.env[RUNTIME_AUTH_TOKEN_ENV_VAR] = original;
        }
    }
});

test('parseArgs falls back to default protocol version and false booleans when omitted', () => {
    const original = process.env[RUNTIME_AUTH_TOKEN_ENV_VAR];
    delete process.env[RUNTIME_AUTH_TOKEN_ENV_VAR];

    try {
        const parsed = parseArgs([]);

        assert.deepEqual(parsed, {
            pipePath: '',
            authToken: '',
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            version: false,
            healthcheck: false,
        });
    } finally {
        if (original !== undefined) {
            process.env[RUNTIME_AUTH_TOKEN_ENV_VAR] = original;
        }
    }
});

test('shared IPC codecs validate spawn payloads and empty responses', () => {
    const spawnPayload = parseRuntimeSpawnPayload({
        command: 'claude',
        args: ['--model', 'sonnet'],
        cwd: 'C:\\vault',
        cols: 80,
        rows: 24,
        env: { TERM: 'xterm-256color' },
    });

    assert.deepEqual(spawnPayload, {
        command: 'claude',
        args: ['--model', 'sonnet'],
        cwd: 'C:\\vault',
        cols: 80,
        rows: 24,
        env: { TERM: 'xterm-256color' },
    });
    assert.equal(parseRuntimeSpawnPayload({ command: 'claude' }), null);

    const emptyPayload = createEmptyPayloadResponse('write');
    assert.deepEqual(emptyPayload, {});
    assert.equal(isResponsePayloadForType('write', emptyPayload), true);
});

test('shared IPC codecs validate runtime events', () => {
    assert.equal(
        isRuntimeEvent({
            event: 'exit',
            payload: {
                sessionId: 'session-1',
                event: { exitCode: 0 },
            },
        }),
        true
    );
    assert.equal(
        isRuntimeEvent({
            event: 'exit',
            payload: {
                sessionId: 'session-1',
                event: { exitCode: '0' },
            },
        }),
        false
    );
});

testOnWindows('Paths builds install, logs, and metadata paths relative to the vault', () => {
    const paths = new Paths();
    const vaultPaths = createVaultPaths();

    assert.equal(paths.getRuntimeInstallDir(vaultPaths), join(vaultPaths.pluginDir, 'bin'));
    assert.equal(paths.getRuntimeLogsDir(vaultPaths), join(vaultPaths.pluginDir, 'logs'));
    assert.equal(paths.getVersionMetadataPath(vaultPaths), join(vaultPaths.pluginDir, 'bin', 'runtime-version.json'));
});

testOnWindows('Paths.getResolvedRuntimePath prefers a configured runtime path', () => {
    const paths = new Paths();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.runtimePath = 'C:\\custom\\galdur-runtime.exe';

    assert.equal(paths.getResolvedRuntimePath(createVaultPaths(), settings), 'C:\\custom\\galdur-runtime.exe');
});

testOnWindows('Paths runtime asset and bundle names match the current machine target', () => {
    const paths = new Paths();
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    assert.equal(paths.getRuntimeAssetName('windows', arch), `galdur-runtime-windows-${arch}.exe`);
    assert.equal(paths.getRuntimeBundleName('windows', arch), `galdur-runtime-windows-${arch}.zip`);
    assert.equal(paths.getDefaultRuntimeAssetName(), `galdur-runtime-windows-${arch}.exe`);
});

testOnWindows('Paths.getLocalArchCandidates returns the expected search order for the current machine', () => {
    const paths = new Paths();

    assert.deepEqual(paths.getLocalArchCandidates(), process.arch === 'arm64' ? ['arm64', 'x64'] : ['x64']);
});
