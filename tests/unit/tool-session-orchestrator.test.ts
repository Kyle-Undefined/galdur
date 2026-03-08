import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { DEFAULT_SETTINGS, MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS, TERM_ENV_VALUE } from '../../src/constants';
import { orchestrateToolSessionLaunch } from '../../src/ui/terminal/toolSessionOrchestrator';
import { createTempDir, removeTempDir } from '../helpers/tempDir';
import type {
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    RuntimeBackend,
    RuntimeHealthResult,
    TerminalExitEvent,
    TerminalSessionStartOptions,
    TerminalSessionStartResult,
    VaultPaths,
} from '../../src/types';
import type {
    MissingToolCommand,
    PreparedToolLaunch,
    ToolSessionOrchestratorHooks,
} from '../../src/ui/terminal/toolSessionOrchestrator';

function cloneSettings() {
    return structuredClone(DEFAULT_SETTINGS);
}

function createHooks(): {
    state: {
        missing: MissingToolCommand[];
        prepared: PreparedToolLaunch[];
        backends: RuntimeBackend[];
        data: Array<{ data: string; backend: RuntimeBackend }>;
        exits: Array<{ event: TerminalExitEvent; backend: RuntimeBackend }>;
        noOutput: Array<{ launch: PreparedToolLaunch; backend: RuntimeBackend }>;
    };
    hooks: ToolSessionOrchestratorHooks;
} {
    const state = {
        missing: [] as MissingToolCommand[],
        prepared: [] as PreparedToolLaunch[],
        backends: [] as RuntimeBackend[],
        data: [] as Array<{ data: string; backend: RuntimeBackend }>,
        exits: [] as Array<{ event: TerminalExitEvent; backend: RuntimeBackend }>,
        noOutput: [] as Array<{ launch: PreparedToolLaunch; backend: RuntimeBackend }>,
    };

    return {
        state,
        hooks: {
            onCommandMissing: (missing) => {
                state.missing.push(missing);
            },
            onPrepared: (launch) => {
                state.prepared.push(launch);
            },
            onBackendCreated: (backend) => {
                state.backends.push(backend);
            },
            onData: (data, backend) => {
                state.data.push({ data, backend });
            },
            onExit: (event, backend) => {
                state.exits.push({ event, backend });
            },
            onNoOutput: (launch, backend) => {
                state.noOutput.push({ launch, backend });
            },
        },
    };
}

function createVaultPaths(): VaultPaths {
    return {
        vaultPath: 'C:\\vault',
        configDir: '.obsidian',
        pluginDir: 'C:\\vault\\.obsidian\\plugins\\galdur',
    };
}

function createTool(
    resolution: CommandResolution,
    buildArgsImpl?: (debugFilePath?: string) => string[]
): CliTool & { buildArgCalls: Array<string | undefined> } {
    const buildArgCalls: Array<string | undefined> = [];
    const settingsSpec: CliToolSettingsSpec = {
        supportedPermissionModes: ['default'],
        permissionModeDescription: '',
        supportsDebugLogging: true,
        debugLoggingDescription: '',
        extraArgsDescription: '',
        extraArgsPlaceholder: '',
    };

    return {
        id: 'claude',
        displayName: 'Claude',
        buildArgCalls,
        async resolveCommand() {
            return resolution;
        },
        getDebugLogPath(vaultPaths: VaultPaths) {
            return join(vaultPaths.pluginDir, 'claude-debug.log');
        },
        buildArgs(_settings, debugFilePath) {
            buildArgCalls.push(debugFilePath);
            return buildArgsImpl ? buildArgsImpl(debugFilePath) : ['--model', 'sonnet'];
        },
        getMissingCliHelp() {
            return 'Install Claude CLI';
        },
        getSettingsSpec() {
            return settingsSpec;
        },
    };
}

function createBackend(result: TerminalSessionStartResult): RuntimeBackend & {
    startCalls: TerminalSessionStartOptions[];
    stopCalls: number;
} {
    const startCalls: TerminalSessionStartOptions[] = [];

    return {
        id: 'managed',
        startCalls,
        stopCalls: 0,
        async healthCheck(): Promise<RuntimeHealthResult> {
            return { ok: true, message: 'ok' };
        },
        async start(options) {
            startCalls.push(options);
            return result;
        },
        async write() {},
        async resize() {},
        async stop() {
            this.stopCalls++;
        },
    };
}

test('orchestrateToolSessionLaunch returns missing-cli and reports the missing command', async () => {
    const tool = createTool({
        command: 'claude',
        source: 'fallback',
        attempts: ['where.exe claude'],
        found: false,
    });
    const { state, hooks } = createHooks();
    let backendCreated = false;

    const result = await orchestrateToolSessionLaunch({
        settings: cloneSettings(),
        tool,
        vaultPaths: createVaultPaths(),
        terminal: { cols: 120, rows: 40 },
        createBackend: () => {
            backendCreated = true;
            return createBackend({ ok: true, pid: 1 });
        },
        isStale: () => false,
        hooks,
    });

    assert.equal(result.kind, 'missing-cli');
    assert.equal(backendCreated, false);
    assert.deepEqual(state.missing, [
        {
            toolDisplayName: 'Claude',
            missingHelp: 'Install Claude CLI',
            attempts: ['where.exe claude'],
        },
    ]);
});

test('orchestrateToolSessionLaunch prepares and starts a backend with clamped terminal size and spawn env', async () => {
    const tempDir = await createTempDir();
    const commandPath = join(tempDir, 'claude.exe');
    const tool = createTool(
        {
            command: commandPath,
            source: 'PATH',
            attempts: ['where.exe claude.exe'],
            found: true,
        },
        () => ['--model', 'sonnet']
    );
    const settings = cloneSettings();
    settings.toolProfiles.claude.debugLoggingEnabled = true;
    const { state, hooks } = createHooks();
    const backend = createBackend({ ok: true, pid: 4321 });

    try {
        const result = await orchestrateToolSessionLaunch({
            settings,
            tool,
            vaultPaths: createVaultPaths(),
            terminal: { cols: 10, rows: 12 },
            createBackend: () => backend,
            isStale: () => false,
            startupTimeoutMs: 1500,
            hooks,
        });

        assert.equal(result.kind, 'started');
        if (result.kind !== 'started') {
            return;
        }

        assert.equal(result.pid, 4321);
        assert.equal(state.prepared.length, 1);
        assert.equal(state.backends[0], backend);
        assert.deepEqual(tool.buildArgCalls, ['C:\\vault\\.obsidian\\plugins\\galdur\\claude-debug.log']);
        assert.equal(backend.startCalls.length, 1);
        assert.deepEqual(backend.startCalls[0].args, ['--model', 'sonnet']);
        assert.equal(backend.startCalls[0].cwd, 'C:\\vault');
        assert.equal(backend.startCalls[0].cols, MIN_TERMINAL_COLS);
        assert.equal(backend.startCalls[0].rows, MIN_TERMINAL_ROWS);
        assert.equal(backend.startCalls[0].startupTimeoutMs, 1500);
        assert.equal(backend.startCalls[0].env.TERM, TERM_ENV_VALUE);
        assert.match(
            (backend.startCalls[0].env.Path ?? backend.startCalls[0].env.PATH ?? '') as string,
            new RegExp(`^${escapeRegExp(tempDir)};`)
        );
        assert.equal(result.launch.commandSource, 'PATH');
        assert.equal(result.launch.debugFilePath, 'C:\\vault\\.obsidian\\plugins\\galdur\\claude-debug.log');
    } finally {
        await removeTempDir(tempDir);
    }
});

test('orchestrateToolSessionLaunch stops the backend when start fails', async () => {
    const tool = createTool({
        command: 'claude.exe',
        source: 'PATH',
        attempts: ['where.exe claude.exe'],
        found: true,
    });
    const { hooks } = createHooks();
    const backend = createBackend({ ok: false, error: new Error('failed to start') });

    const result = await orchestrateToolSessionLaunch({
        settings: cloneSettings(),
        tool,
        vaultPaths: createVaultPaths(),
        terminal: { cols: 120, rows: 40 },
        createBackend: () => backend,
        isStale: () => false,
        hooks,
    });

    assert.equal(result.kind, 'failed');
    assert.equal(backend.stopCalls, 1);
});

test('orchestrateToolSessionLaunch stops the backend and returns aborted when it becomes stale after startup', async () => {
    let stale = false;
    const tool = createTool({
        command: 'claude.exe',
        source: 'PATH',
        attempts: ['where.exe claude.exe'],
        found: true,
    });
    const { hooks } = createHooks();
    const backend = createBackend({ ok: true, pid: 99 });
    const originalStart = backend.start.bind(backend);
    backend.start = async (options) => {
        const result = await originalStart(options);
        stale = true;
        return result;
    };

    const result = await orchestrateToolSessionLaunch({
        settings: cloneSettings(),
        tool,
        vaultPaths: createVaultPaths(),
        terminal: { cols: 120, rows: 40 },
        createBackend: () => backend,
        isStale: () => stale,
        hooks,
    });

    assert.equal(result.kind, 'aborted');
    assert.equal(backend.stopCalls, 1);
    assert.equal(result.backend, backend);
});

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
