export type ToolId = 'claude' | 'codex';

export type VaultPaths = {
    vaultPath: string;
    configDir: string;
    pluginDir: string;
};

export type CommandResolution = {
    command: string;
    source: string;
    attempts: string[];
    found: boolean;
};

export type ToolPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'delegate' | 'dontAsk' | 'plan';

export interface ToolLaunchProfile {
    permissionMode: ToolPermissionMode;
    extraArgs: string;
    debugLoggingEnabled: boolean;
}

export type CliToolSettingsSpec = {
    supportedPermissionModes: readonly ToolPermissionMode[];
    permissionModeDescription: string;
    supportsDebugLogging: boolean;
    debugLoggingDescription: string;
    extraArgsDescription: string;
    extraArgsPlaceholder: string;
};

export interface GaldurSettings {
    activeToolId: ToolId;
    toolProfiles: Record<ToolId, ToolLaunchProfile>;
    runtimePath: string;
    runtimeVersion: string | null;
    runtimeAutoStart: boolean;
    runtimeConnectTimeoutMs: number;
}

export interface GaldurSettingsStore {
    settings: GaldurSettings;
    saveSettings(): Promise<void>;
    stopRuntimeHostForMaintenance?(): Promise<void>;
    startRuntimeHostAfterMaintenance?(): Promise<void> | void;
}

export interface GaldurViewContext {
    getSettings(): GaldurSettings;
    saveSettings(): Promise<void>;
    getPluginVersion(): string;
    openSettings(): void;
}

export interface CliTool {
    id: ToolId;
    displayName: string;
    resolveCommand(): Promise<CommandResolution>;
    getDebugLogPath(vaultPaths: VaultPaths): string;
    buildArgs(settings: GaldurSettings, debugFilePath?: string): string[];
    getMissingCliHelp(): string;
    getSettingsSpec(): CliToolSettingsSpec;
}

import type { TerminalExitEvent } from '../shared/ipc-types';
export type { TerminalExitEvent };

export type TerminalSessionStartOptions = {
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: NodeJS.ProcessEnv;
    startupTimeoutMs?: number;
    onData: (data: string) => void;
    onExit: (event: TerminalExitEvent) => void;
    onNoOutput: () => void;
};

export type TerminalSessionStartResult = { ok: true; pid: number } | { ok: false; error: Error | string };

export type RuntimeHealthResult = {
    ok: boolean;
    message: string;
};

export interface RuntimeBackend {
    readonly id: 'managed';
    healthCheck(): Promise<RuntimeHealthResult>;
    start(options: TerminalSessionStartOptions): Promise<TerminalSessionStartResult>;
    write(data: string): Promise<void>;
    resize(cols: number, rows: number): Promise<void>;
    stop(): Promise<void>;
}

export type RuntimeInstallStatusState = 'not-installed' | 'installed' | 'outdated' | 'error';

export type RuntimeInstallStatus = {
    state: RuntimeInstallStatusState;
    runtimePath: string;
    installDir: string;
    installedVersion: string | null;
    targetVersion: string;
    isCustomPath: boolean;
    message?: string;
};
