import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { DEFAULT_SETTINGS, RUNTIME_AUTH_TOKEN_ENV_VAR, RUNTIME_PROTOCOL_VERSION } from '../../src/constants';
import { createRequest } from '../../src/services/runtime/createRequest';
import { parseArgs } from '../../runtime/src/args';
import { Paths } from '../../src/services/runtime/Paths';

const testOnWindows = process.platform === 'win32' ? test : test.skip;

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

testOnWindows('Paths builds install, logs, and metadata paths relative to the vault', () => {
    const paths = new Paths();
    const vaultPath = 'C:\\vault';

    assert.equal(paths.getRuntimeInstallDir(vaultPath), join(vaultPath, '.obsidian', 'plugins', 'galdur', 'bin'));
    assert.equal(paths.getRuntimeLogsDir(vaultPath), join(vaultPath, '.obsidian', 'plugins', 'galdur', 'logs'));
    assert.equal(
        paths.getVersionMetadataPath(vaultPath),
        join(vaultPath, '.obsidian', 'plugins', 'galdur', 'bin', 'runtime-version.json')
    );
});

testOnWindows('Paths.getResolvedRuntimePath prefers a configured runtime path', () => {
    const paths = new Paths();
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.runtimePath = 'C:\\custom\\galdur-runtime.exe';

    assert.equal(paths.getResolvedRuntimePath('C:\\vault', settings), 'C:\\custom\\galdur-runtime.exe');
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
