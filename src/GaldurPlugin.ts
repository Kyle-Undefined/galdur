import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, VIEW_TYPE_GALDUR } from './constants';
import { mergeToolProfiles, sanitizeLoadedSettings } from './settings/settingsHelpers';
import { Manager } from './services/runtime/Manager';
import { HostService } from './services/runtime/HostService';
import { GaldurSettings } from './types';
import { TerminalView } from './ui/TerminalView';
import { SettingTab } from './ui/SettingTab';
import xtermCssText from '@xterm/xterm/css/xterm.css';
import { getVaultPaths } from './utils/vault';

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

    public startRuntimeHostAfterMaintenance(): void {
        if (this.disposed) {
            return;
        }
        this.runtimeMaintenanceMode = false;
    }

    private async loadSettings(): Promise<void> {
        const loaded = sanitizeLoadedSettings(await this.loadData());

        this.settings = {
            ...DEFAULT_SETTINGS,
            ...loaded,
            toolProfiles: mergeToolProfiles(loaded.toolProfiles),
        };
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
