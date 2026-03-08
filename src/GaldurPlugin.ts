import { Plugin } from 'obsidian';
import { createDefaultToolProfile, DEFAULT_SETTINGS, TOOL_OPTIONS, VIEW_TYPE_GALDUR } from './constants';
import { Manager } from './services/runtime/Manager';
import { HostService } from './services/runtime/HostService';
import { GaldurSettings, ToolId, ToolLaunchProfile, ToolProfileRecord } from './types';
import { getTool } from './tools/toolRegistry';
import { TerminalView } from './ui/TerminalView';
import { SettingTab } from './ui/SettingTab';
import xtermCssText from '@xterm/xterm/css/xterm.css';
import { getVaultPaths } from './utils/vault';

type SanitizedToolProfiles = {
    [K in ToolId]?: Partial<ToolLaunchProfile<K>>;
};

type SanitizedLoadedSettings = Partial<Omit<GaldurSettings, 'toolProfiles'>> & { toolProfiles?: SanitizedToolProfiles };

export default class GaldurPlugin extends Plugin {
    private xtermStyleEl: HTMLStyleElement | null = null;
    private readonly runtimeManager = new Manager();
    private runtimeHost: HostService | null = null;
    private runtimeMaintenanceMode = false;
    private disposed = false;
    public settings: GaldurSettings = { ...DEFAULT_SETTINGS };

    public async onload(): Promise<void> {
        await this.loadSettings();
        this.installXtermCss();
        const vaultPaths = getVaultPaths(this.app);
        this.runtimeHost = new HostService(vaultPaths, this.runtimeManager);

        this.registerView(
            VIEW_TYPE_GALDUR,
            (leaf) =>
                new TerminalView(
                    leaf,
                    {
                        getSettings: () => this.settings,
                        saveSettings: async () => this.saveSettings(),
                        getPluginVersion: () => this.manifest.version,
                        openSettings: () => this.openSettingsTab(),
                    },
                    this.runtimeManager,
                    () => this.getRuntimeHost()
                )
        );
        this.addSettingTab(new SettingTab(this.app, this, this.runtimeManager));

        this.addRibbonIcon('terminal', 'Open Galdur panel', () => {
            void this.activateView();
        });

        this.addCommand({
            id: 'toggle-galdur-panel',
            name: 'Toggle Galdur panel',
            callback: () => {
                void this.toggleView();
            },
        });

        this.addCommand({
            id: 'start-galdur-session',
            name: 'Start Galdur session',
            callback: () => {
                void this.startSession();
            },
        });

        this.addCommand({
            id: 'stop-galdur-session',
            name: 'Stop Galdur session',
            callback: () => {
                this.stopSession();
            },
        });
    }

    public onunload(): void {
        this.disposed = true;
        this.runtimeMaintenanceMode = true;
        this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR).forEach((leaf) => leaf.detach());

        void this.runtimeHost?.dispose();
        this.runtimeHost = null;

        this.xtermStyleEl?.remove();
        this.xtermStyleEl = null;
    }

    public async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    public async stopRuntimeHostForMaintenance(): Promise<void> {
        this.runtimeMaintenanceMode = true;
        await this.runtimeHost?.dispose();
        this.runtimeHost = null;
    }

    // Clears maintenance mode so getRuntimeHost() can lazily recreate the host on next use.
    public startRuntimeHostAfterMaintenance(): void {
        if (this.disposed) {
            return;
        }
        this.runtimeMaintenanceMode = false;
    }

    private async loadSettings(): Promise<void> {
        const loaded = this.sanitizeLoadedSettings(await this.loadData());

        this.settings = {
            ...DEFAULT_SETTINGS,
            ...loaded,
            toolProfiles: this.mergeToolProfiles(loaded.toolProfiles),
        };
    }

    private mergeToolProfiles(loadedProfiles?: SanitizedToolProfiles): ToolProfileRecord {
        const merged = {} as ToolProfileRecord;
        for (const toolId of TOOL_OPTIONS) {
            this.setMergedToolProfile(merged, toolId, loadedProfiles?.[toolId]);
        }
        return merged;
    }

    private setMergedToolProfile<TToolId extends ToolId>(
        profiles: ToolProfileRecord,
        toolId: TToolId,
        loadedProfile?: Partial<ToolLaunchProfile<TToolId>>
    ): void {
        (profiles as Record<ToolId, ToolLaunchProfile>)[toolId] = {
            ...createDefaultToolProfile(toolId),
            ...loadedProfile,
        } as ToolLaunchProfile<TToolId>;
    }

    private sanitizeLoadedSettings(value: unknown): SanitizedLoadedSettings {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return {};
        }

        const record = value as Record<string, unknown>;
        const sanitized: SanitizedLoadedSettings = {};
        if (this.isToolId(record.activeToolId)) {
            sanitized.activeToolId = record.activeToolId;
        }
        if (typeof record.runtimePath === 'string') {
            sanitized.runtimePath = record.runtimePath;
        }
        if (typeof record.runtimeVersion === 'string' || record.runtimeVersion === null) {
            sanitized.runtimeVersion = record.runtimeVersion;
        }
        if (typeof record.runtimeAutoStart === 'boolean') {
            sanitized.runtimeAutoStart = record.runtimeAutoStart;
        }
        if (typeof record.runtimeConnectTimeoutMs === 'number' && Number.isFinite(record.runtimeConnectTimeoutMs)) {
            sanitized.runtimeConnectTimeoutMs = Math.trunc(record.runtimeConnectTimeoutMs);
        }

        const toolProfiles = this.sanitizeToolProfiles(record.toolProfiles);
        if (toolProfiles) {
            sanitized.toolProfiles = toolProfiles;
        }
        return sanitized;
    }

    private sanitizeToolProfiles(value: unknown): SanitizedToolProfiles | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const rawProfiles = value as Record<string, unknown>;
        const sanitized: SanitizedToolProfiles = {};
        for (const toolId of TOOL_OPTIONS) {
            const profile = this.sanitizeToolProfile(toolId, rawProfiles[toolId]);
            if (!profile) {
                continue;
            }
            (sanitized as Partial<Record<ToolId, Partial<ToolLaunchProfile>>>)[toolId] = profile;
        }

        return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }

    private sanitizeToolProfile<TToolId extends ToolId>(
        toolId: TToolId,
        value: unknown
    ): Partial<ToolLaunchProfile<TToolId>> | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
        }

        const rawProfile = value as Record<string, unknown>;
        const profile: Partial<ToolLaunchProfile<TToolId>> = {};
        if (this.isPermissionMode(toolId, rawProfile.permissionMode)) {
            profile.permissionMode = rawProfile.permissionMode;
        }
        if (typeof rawProfile.extraArgs === 'string') {
            profile.extraArgs = rawProfile.extraArgs;
        }
        if (typeof rawProfile.debugLoggingEnabled === 'boolean') {
            profile.debugLoggingEnabled = rawProfile.debugLoggingEnabled;
        }

        return Object.keys(profile).length > 0 ? profile : undefined;
    }

    private isToolId(value: unknown): value is ToolId {
        return typeof value === 'string' && TOOL_OPTIONS.includes(value as ToolId);
    }

    private isPermissionMode<TToolId extends ToolId>(
        toolId: TToolId,
        value: unknown
    ): value is ToolLaunchProfile<TToolId>['permissionMode'] {
        if (typeof value !== 'string') {
            return false;
        }

        const tool = getTool(toolId);
        const permissionModes = tool?.getSettingsSpec()?.permissionModes;
        if (!permissionModes) {
            return false;
        }
        return permissionModes.some((mode) => mode.value === value);
    }

    private async toggleView(): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR);
        if (leaves.length > 0) {
            leaves.forEach((leaf) => leaf.detach());
            return;
        }

        await this.activateView();
    }

    private async activateView(): Promise<void> {
        const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR);
        if (existingLeaves.length > 0) {
            await this.app.workspace.revealLeaf(existingLeaves[0]);
            return;
        }

        const leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) {
            return;
        }

        await leaf.setViewState({
            type: VIEW_TYPE_GALDUR,
            active: true,
        });
        await this.app.workspace.revealLeaf(leaf);
    }

    private async startSession(): Promise<void> {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR)[0];
        if (!leaf) {
            await this.activateView();
            return;
        }

        const view = leaf.view;
        if (view instanceof TerminalView) {
            await view.startSession();
            await this.app.workspace.revealLeaf(leaf);
        }
    }

    private stopSession(): void {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR)[0];
        if (!leaf) {
            return;
        }

        const view = leaf.view;
        if (view instanceof TerminalView) {
            view.stopSession();
            void this.app.workspace.revealLeaf(leaf);
        }
    }

    private openSettingsTab(): void {
        const appWithSettings = this.app as typeof this.app & {
            setting?: {
                open(): void;
                openTabById(tabId: string): void;
            };
        };

        appWithSettings.setting?.open();
        appWithSettings.setting?.openTabById(this.manifest.id);
    }

    private installXtermCss(): void {
        const styleId = 'galdur-xterm-css';
        const existing = document.getElementById(styleId);
        if (existing instanceof HTMLStyleElement) {
            this.xtermStyleEl = existing;
            return;
        }

        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.setText(xtermCssText);
        document.head.appendChild(styleEl);
        this.xtermStyleEl = styleEl;
    }

    private getRuntimeHost(): HostService {
        if (this.disposed) {
            throw new Error('Plugin has been unloaded.');
        }
        if (this.runtimeMaintenanceMode) {
            throw new Error('Runtime host is paused for maintenance.');
        }
        if (!this.runtimeHost) {
            const vaultPaths = getVaultPaths(this.app);
            this.runtimeHost = new HostService(vaultPaths, this.runtimeManager);
        }
        return this.runtimeHost;
    }
}
