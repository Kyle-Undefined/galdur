export type PtyModule = typeof import("node-pty");

export type ToolId = "claude";

export type CommandResolution = {
  command: string;
  source: string;
  attempts: string[];
  found: boolean;
};

export type PtyModuleResolution = {
  module: PtyModule | null;
  attempts: string[];
  errors: string[];
};

export type ToolPermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "delegate"
  | "dontAsk"
  | "plan";

export interface ToolLaunchProfile {
  permissionMode: ToolPermissionMode;
  extraArgs: string;
  debugLoggingEnabled: boolean;
}

export interface GaldurSettings {
  activeToolId: ToolId;
  toolProfiles: Record<ToolId, ToolLaunchProfile>;
}

export interface GaldurSettingsStore {
  settings: GaldurSettings;
  saveSettings(): Promise<void>;
}

export interface GaldurViewContext {
  getSettings(): GaldurSettings;
}

export interface CliToolAdapter {
  id: ToolId;
  displayName: string;
  resolveCommand(): CommandResolution;
  getDebugLogPath(vaultPath: string): string;
  buildArgs(settings: GaldurSettings, debugFilePath?: string): string[];
  getMissingCliHelp(): string;
}
