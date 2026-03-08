import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { DEFAULT_TOOL_PROFILE, MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS, STARTUP_TIMEOUT_MS } from '../../constants';
import {
    CliTool,
    GaldurSettings,
    ResolvedContextGuard,
    RuntimeBackend,
    TerminalExitEvent,
    VaultPaths,
} from '../../types';
import { buildSpawnEnv } from './spawnEnv';

export type PreparedToolLaunch = {
    command: string;
    commandSource: string;
    args: string[];
    toolDisplayName: string;
    debugLoggingEnabled: boolean;
    debugFilePath?: string;
    startupTimeoutMs: number;
    contextGuard: ResolvedContextGuard;
};

export type MissingToolCommand = {
    toolDisplayName: string;
    missingHelp: string;
    attempts: string[];
};

export type ToolSessionOrchestratorHooks = {
    onCommandMissing: (missing: MissingToolCommand) => void;
    onPrepared: (launch: PreparedToolLaunch) => void;
    onBackendCreated: (backend: RuntimeBackend) => void;
    onData: (data: string, backend: RuntimeBackend) => void;
    onExit: (event: TerminalExitEvent, backend: RuntimeBackend) => void;
    onNoOutput: (launch: PreparedToolLaunch, backend: RuntimeBackend) => void;
};

export type ToolSessionOrchestratorArgs = {
    settings: GaldurSettings;
    tool: CliTool;
    vaultPaths: VaultPaths;
    terminal: { cols: number; rows: number };
    createBackend: () => RuntimeBackend;
    isStale: () => boolean;
    contextGuard?: ResolvedContextGuard;
    startupTimeoutMs?: number;
    hooks: ToolSessionOrchestratorHooks;
};

export type ToolSessionLaunchResult =
    | { kind: 'aborted'; backend?: RuntimeBackend }
    | { kind: 'missing-cli' }
    | { kind: 'failed'; backend: RuntimeBackend; error: unknown }
    | {
          kind: 'started';
          backend: RuntimeBackend;
          pid: number;
          launch: PreparedToolLaunch;
      };

export async function orchestrateToolSessionLaunch(
    args: ToolSessionOrchestratorArgs
): Promise<ToolSessionLaunchResult> {
    const commandResolution = await args.tool.resolveCommand();
    if (args.isStale()) {
        return { kind: 'aborted' };
    }

    if (!commandResolution.found) {
        args.hooks.onCommandMissing({
            toolDisplayName: args.tool.displayName,
            missingHelp: args.tool.getMissingCliHelp(),
            attempts: commandResolution.attempts,
        });
        return { kind: 'missing-cli' };
    }

    const profile = args.settings.toolProfiles[args.settings.activeToolId] ?? DEFAULT_TOOL_PROFILE;
    const debugFilePath = args.tool.getDebugLogPath(args.vaultPaths);
    const contextGuard = args.contextGuard ?? {
        excludedTags: [],
        excludedNotePaths: [],
        toolArgs: [],
        supportLevel: 'none',
        supportMessage: 'Global tag guard is off.',
    };
    const launch: PreparedToolLaunch = {
        command: commandResolution.command,
        commandSource: commandResolution.source,
        args: [
            ...args.tool.buildArgs(args.settings, profile.debugLoggingEnabled ? debugFilePath : undefined),
            ...contextGuard.toolArgs,
        ],
        toolDisplayName: args.tool.displayName,
        debugLoggingEnabled: profile.debugLoggingEnabled,
        debugFilePath: profile.debugLoggingEnabled ? debugFilePath : undefined,
        startupTimeoutMs: args.startupTimeoutMs ?? STARTUP_TIMEOUT_MS,
        contextGuard,
    };

    if (profile.debugLoggingEnabled && debugFilePath) {
        await mkdir(dirname(debugFilePath), { recursive: true });
    }

    args.hooks.onPrepared(launch);
    if (args.isStale()) {
        return { kind: 'aborted' };
    }

    const backend = args.createBackend();
    args.hooks.onBackendCreated(backend);

    const cols = Math.max(args.terminal.cols, MIN_TERMINAL_COLS);
    const rows = Math.max(args.terminal.rows, MIN_TERMINAL_ROWS);

    const toolEnvOverrides = args.tool.getSpawnEnvOverrides?.(args.settings);
    const result = await backend.start({
        command: launch.command,
        args: launch.args,
        cwd: args.vaultPaths.vaultPath,
        cols,
        rows,
        env: buildSpawnEnv(launch.command, toolEnvOverrides ? { ...process.env, ...toolEnvOverrides } : process.env),
        startupTimeoutMs: launch.startupTimeoutMs,
        onData: (data) => {
            args.hooks.onData(data, backend);
        },
        onExit: (event) => {
            args.hooks.onExit(event, backend);
        },
        onNoOutput: () => {
            args.hooks.onNoOutput(launch, backend);
        },
    });

    if (args.isStale()) {
        await backend.stop().catch(() => undefined);
        return { kind: 'aborted', backend };
    }

    if (!result.ok) {
        await backend.stop().catch(() => undefined);
        return { kind: 'failed', backend, error: result.error };
    }

    return { kind: 'started', backend, pid: result.pid, launch };
}
