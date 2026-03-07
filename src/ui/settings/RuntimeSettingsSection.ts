import { App, Notice, Plugin, Setting } from 'obsidian';
import {
    DEFAULT_CONNECT_TIMEOUT_MS,
    ERROR_NOTICE_DURATION_MS,
    MIN_CONNECT_TIMEOUT_MS,
    RUNTIME_RELEASE_REPO,
} from '../../constants';
import { Manager } from '../../services/runtime/Manager';
import { GaldurSettingsStore, RuntimeInstallStatus } from '../../types';
import { getVaultPath } from '../../utils/vault';
import {
    addActionButton,
    buildRuntimeStatusDescription,
    INSTALL_LIKE_RUNTIME_ACTIONS,
    openPathInElectron,
    RUNTIME_ACTION_LABELS,
    RuntimeAction,
} from './runtimeSettingsUi';

type RuntimeSettingsSectionDeps = {
    app: App;
    store: GaldurSettingsStore;
    plugin: Plugin;
    runtimeManager: Manager;
    saveNow: () => Promise<void>;
    saveDebounced: () => void;
    refresh: () => void;
};

export class RuntimeSettingsSection {
    private runtimeBusyAction: RuntimeAction | null = null;

    public constructor(private readonly deps: RuntimeSettingsSectionDeps) {}

    public render(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Runtime').setHeading();

        const statusSetting = new Setting(containerEl)
            .setName('Status')
            .setDesc('Checking runtime installation status...');

        const actionsAnchor = containerEl.createDiv();
        void this.renderRuntimeStatus(statusSetting, actionsAnchor);

        new Setting(containerEl)
            .setName('Path override')
            .setDesc('Optional command/path override. Leave empty to use managed runtime in plugin bin/ folder.')
            .addText((text) => {
                text.setPlaceholder('C:\\path\\to\\galdur-runtime-windows-x64.exe')
                    .setValue(this.deps.store.settings.runtimePath)
                    .onChange((value) => {
                        this.deps.store.settings.runtimePath = value;
                        this.deps.saveDebounced();
                    });
                text.inputEl.style.width = '100%';
            });

        new Setting(containerEl)
            .setName('Auto-start')
            .setDesc('Automatically launches runtime when no active runtime process is reachable.')
            .addToggle((toggle) => {
                toggle.setValue(this.deps.store.settings.runtimeAutoStart).onChange(async (value) => {
                    this.deps.store.settings.runtimeAutoStart = value;
                    await this.deps.saveNow();
                });
            });

        new Setting(containerEl)
            .setName('Connect timeout (ms)')
            .setDesc('Timeout for runtime IPC connect and request startup.')
            .addText((text) => {
                const inputEl = text.inputEl;
                text.setPlaceholder(String(DEFAULT_CONNECT_TIMEOUT_MS))
                    .setValue(String(this.deps.store.settings.runtimeConnectTimeoutMs))
                    .onChange((value) => {
                        const parsed = Number.parseInt(value, 10);
                        if (!Number.isFinite(parsed) || parsed < MIN_CONNECT_TIMEOUT_MS) {
                            return;
                        }
                        this.deps.store.settings.runtimeConnectTimeoutMs = parsed;
                        this.deps.saveDebounced();
                    });
                inputEl.addEventListener('blur', () => {
                    const parsed = Number.parseInt(inputEl.value, 10);
                    if (!Number.isFinite(parsed) || parsed < MIN_CONNECT_TIMEOUT_MS) {
                        new Notice(`Connect timeout must be at least ${MIN_CONNECT_TIMEOUT_MS}ms`);
                        inputEl.value = String(this.deps.store.settings.runtimeConnectTimeoutMs);
                        return;
                    }

                    inputEl.value = String(parsed);
                    if (this.deps.store.settings.runtimeConnectTimeoutMs === parsed) {
                        return;
                    }

                    this.deps.store.settings.runtimeConnectTimeoutMs = parsed;
                    void this.deps.saveNow();
                });
            });
    }

    private async renderRuntimeStatus(statusSetting: Setting, containerEl: HTMLElement): Promise<void> {
        const settings = this.deps.store.settings;
        const vaultPath = getVaultPath(this.deps.app);
        let status: RuntimeInstallStatus;
        let localDevInstallAvailable = false;
        try {
            localDevInstallAvailable = await this.deps.runtimeManager.hasLocalRuntimeSource(vaultPath);
            status = await this.deps.runtimeManager.getInstallStatus(
                vaultPath,
                settings,
                this.deps.plugin.manifest.version
            );
        } catch (error) {
            status = {
                state: 'error',
                runtimePath: this.deps.runtimeManager.getResolvedRuntimePath(vaultPath, settings),
                installDir: this.deps.runtimeManager.getRuntimeInstallDir(vaultPath),
                installedVersion: null,
                targetVersion: this.deps.plugin.manifest.version,
                isCustomPath: settings.runtimePath.trim().length > 0,
                message: String(error),
            };
        }
        statusSetting.setDesc(buildRuntimeStatusDescription(status));

        this.addRuntimeActionButtons(containerEl, status, localDevInstallAvailable);
        this.addRuntimeResourceButtons(containerEl, status);
    }

    private addRuntimeActionButtons(
        containerEl: HTMLElement,
        status: RuntimeInstallStatus,
        localDevInstallAvailable: boolean
    ): void {
        const runAction = (action: RuntimeAction) => this.runRuntimeAction(action);

        if (status.isCustomPath) {
            const setting = new Setting(containerEl)
                .setName('Custom runtime path')
                .setDesc('Using a custom runtime path override. Managed release install controls are disabled.');
            setting.addButton((button) => {
                button.setButtonText('Clear custom path').onClick(async () => {
                    this.deps.store.settings.runtimePath = '';
                    await this.deps.saveNow();
                    this.deps.refresh();
                });
            });
            this.addLocalDevInstallButton(setting, runAction, localDevInstallAvailable);
            return;
        }

        const actions = new Setting(containerEl).setName('Actions');
        if (this.runtimeBusyAction) {
            actions.setDesc(`${this.getBusyLabel(this.runtimeBusyAction)}...`);
            actions.addButton((button) => {
                button.setButtonText('Working...').setDisabled(true);
            });
            return;
        }

        if (status.state === 'not-installed' || status.state === 'error') {
            actions.setDesc('Install runtime into .obsidian/plugins/galdur/bin.');
            addActionButton(actions, 'Install runtime', 'install', runAction, {
                cta: true,
            });
            this.addLocalDevInstallButton(actions, runAction, localDevInstallAvailable);
            return;
        }

        if (status.state === 'outdated') {
            actions.setDesc('Runtime version differs from plugin version.');
            addActionButton(actions, 'Update runtime', 'update', runAction, {
                cta: true,
            });
            addActionButton(actions, 'Reinstall', 'reinstall', runAction);
            addActionButton(actions, 'Uninstall', 'uninstall', runAction, {
                warning: true,
            });
            this.addLocalDevInstallButton(actions, runAction, localDevInstallAvailable);
            return;
        }

        actions.setDesc('Runtime is installed.');
        addActionButton(actions, 'Reinstall', 'reinstall', runAction);
        addActionButton(actions, 'Uninstall', 'uninstall', runAction, {
            warning: true,
        });
        this.addLocalDevInstallButton(actions, runAction, localDevInstallAvailable);
    }

    private addRuntimeResourceButtons(containerEl: HTMLElement, status: RuntimeInstallStatus): void {
        new Setting(containerEl)
            .setName('Resources')
            .setDesc('Open runtime installation and logs directories.')
            .addButton((button) => {
                button.setButtonText('Open runtime folder').onClick(() => {
                    void this.openPath(status.installDir);
                });
            })
            .addButton((button) => {
                button.setButtonText('Open logs folder').onClick(async () => {
                    const vaultPath = getVaultPath(this.deps.app);
                    try {
                        const logsDir = await this.deps.runtimeManager.ensureRuntimeLogsDir(vaultPath);
                        await this.openPath(logsDir);
                    } catch (error) {
                        new Notice(`Could not create logs folder. Error: ${String(error)}`);
                    }
                });
            })
            .addButton((button) => {
                button.setButtonText('Release page').onClick(() => {
                    window.open(`https://github.com/${RUNTIME_RELEASE_REPO}/releases`, '_blank');
                });
            });
    }

    private async runRuntimeAction(action: RuntimeAction): Promise<void> {
        if (this.runtimeBusyAction !== null) {
            return;
        }
        this.runtimeBusyAction = action;
        this.deps.refresh();

        const vaultPath = getVaultPath(this.deps.app);
        try {
            await this.deps.store.stopRuntimeHostForMaintenance?.();

            if (INSTALL_LIKE_RUNTIME_ACTIONS.includes(action)) {
                const result = await this.deps.runtimeManager.installRuntime(
                    vaultPath,
                    this.deps.plugin.manifest.version
                );
                this.deps.store.settings.runtimeVersion = result.version;
            } else if (action === 'installLocalExe') {
                const result = await this.deps.runtimeManager.installLocalBuiltRuntime(
                    vaultPath,
                    this.deps.plugin.manifest.version
                );
                // Set as custom path override so the dev runtime is used instead of the managed release.
                this.deps.store.settings.runtimePath = result.runtimePath;
                this.deps.store.settings.runtimeVersion = result.version;
            } else if (action === 'uninstall') {
                await this.deps.runtimeManager.uninstallRuntime(vaultPath);
                this.deps.store.settings.runtimeVersion = null;
            }
            await this.deps.saveNow();
            new Notice(`Galdur runtime ${this.getActionPastTense(action)} successfully.`);
        } catch (error) {
            const message = `Galdur runtime ${action} failed: ${String(error)}`;
            new Notice(message, ERROR_NOTICE_DURATION_MS);
        } finally {
            try {
                await this.deps.store.startRuntimeHostAfterMaintenance?.();
            } catch (restartError) {
                console.error('Failed to restart runtime host after maintenance:', restartError);
                new Notice('Runtime maintenance completed, but failed to restart. You may need to restart manually.');
            }

            this.runtimeBusyAction = null;
            this.deps.refresh();
        }
    }

    private getActionPastTense(action: RuntimeAction): string {
        return RUNTIME_ACTION_LABELS[action].pastTense;
    }

    private getBusyLabel(action: RuntimeAction): string {
        return RUNTIME_ACTION_LABELS[action].busyLabel;
    }

    private addLocalDevInstallButton(
        setting: Setting,
        onClick: (action: RuntimeAction) => Promise<void>,
        localDevInstallAvailable: boolean
    ): void {
        if (!localDevInstallAvailable) {
            return;
        }
        addActionButton(setting, 'Install local runtime (dev)', 'installLocalExe', onClick);
    }

    private async openPath(path: string): Promise<void> {
        try {
            await openPathInElectron(path);
        } catch (error) {
            new Notice(String(error));
        }
    }
}
