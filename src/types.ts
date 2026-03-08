export type ToolId = 'claude' | 'codex' | 'gemini' | 'opencode';

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

export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'dontAsk' | 'plan';

export type CodexPermissionMode =
    | 'default'
    | 'readOnly'
    | 'workspaceWrite'
    | 'workspaceWriteNever'
    | 'fullAuto'
    | 'dangerFullAccess'
    | 'bypassApprovalsAndSandbox';

export type GeminiPermissionMode =
    | 'default'
    | 'sandbox'
    | 'autoEdit'
    | 'sandboxAutoEdit'
    | 'plan'
    | 'sandboxPlan'
    | 'yolo'
    | 'sandboxYolo';

export type OpenCodePermissionMode = 'default' | 'askOnEditAndBash' | 'readOnly' | 'askAll' | 'allowAll';

export type ToolPermissionModeMap = {
    claude: ClaudePermissionMode;
    codex: CodexPermissionMode;
    gemini: GeminiPermissionMode;
    opencode: OpenCodePermissionMode;
};

export type ToolPermissionMode = ToolPermissionModeMap[ToolId];

export interface ToolLaunchProfile<TToolId extends ToolId = ToolId> {
    permissionMode: ToolPermissionModeMap[TToolId];
    extraArgs: string;
    debugLoggingEnabled: boolean;
}

export type ToolPermissionModeOption<TValue extends string = string> = {
    value: TValue;
    label: string;
};

export type CliToolSettingsSpec<TToolId extends ToolId = ToolId> = {
    permissionModeLabel: string;
    permissionModes: readonly ToolPermissionModeOption<ToolPermissionModeMap[TToolId]>[];
    permissionModeDescription: string;
    supportsDebugLogging: boolean;
    debugLoggingDescription: string;
    extraArgsDescription: string;
    extraArgsPlaceholder: string;
};

export type ToolProfileRecord = { [K in ToolId]: ToolLaunchProfile<K> };

export interface GaldurSettings {
    activeToolId: ToolId;
    toolProfiles: ToolProfileRecord;
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

export interface CliTool<TToolId extends ToolId = ToolId> {
    id: TToolId;
    displayName: string;
    resolveCommand(): Promise<CommandResolution>;
    getDebugLogPath(vaultPaths: VaultPaths): string;
    buildArgs(settings: GaldurSettings, debugFilePath?: string): string[];
    getSpawnEnvOverrides?(settings: GaldurSettings): NodeJS.ProcessEnv | undefined;
    getMissingCliHelp(): string;
    getSettingsSpec(): CliToolSettingsSpec<TToolId>;
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
