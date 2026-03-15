import { Setting } from 'obsidian';
import { createDefaultToolProfile, isToolId, TOOL_EXTRA_ARGS_ROWS, TOOL_OPTIONS } from '../../constants';
import { requireTool } from '../../tools/toolRegistry';
import { GaldurSettingsStore, ToolId, ToolLaunchProfile, ToolPermissionMode, ToolProfileRecord } from '../../types';

type ToolSettingsSectionDeps = {
    store: GaldurSettingsStore;
    saveNow: () => Promise<void>;
    saveDebounced: () => void;
    refresh: () => void;
};

function setToolProfile<TToolId extends ToolId>(
    profiles: ToolProfileRecord,
    toolId: TToolId,
    profile: ToolLaunchProfile<TToolId>
): void {
    profiles[toolId] = profile as ToolProfileRecord[TToolId];
}

export class ToolSettingsSection {
    public constructor(private readonly deps: ToolSettingsSectionDeps) {}

    public render(containerEl: HTMLElement): void {
        const activeTool = requireTool(this.deps.store.settings.activeToolId);
        const settingsSpec = activeTool.getSettingsSpec();

        new Setting(containerEl)
            .setName('CLI tool')
            .setDesc('Tool opened in the Galdur terminal panel.')
            .addDropdown((dropdown) => {
                for (const toolId of TOOL_OPTIONS) {
                    const tool = requireTool(toolId);
                    dropdown.addOption(toolId, tool.displayName);
                }
                dropdown.setValue(this.deps.store.settings.activeToolId).onChange(async (value) => {
                    if (!isToolId(value)) {
                        return;
                    }
                    this.deps.store.settings.activeToolId = value;
                    await this.deps.saveNow();
                    this.deps.refresh();
                });
            });

        new Setting(containerEl)
            .setName(settingsSpec.permissionModeLabel)
            .setDesc(settingsSpec.permissionModeDescription)
            .addDropdown((dropdown) => {
                for (const mode of settingsSpec.permissionModes) {
                    dropdown.addOption(mode.value, mode.label);
                }
                dropdown.setValue(this.getActiveProfile().permissionMode).onChange(async (value) => {
                    if (!this.isActiveToolPermissionMode(value)) {
                        return;
                    }
                    this.updateActiveProfile((profile) => ({
                        ...profile,
                        permissionMode: value,
                    }));
                    await this.deps.saveNow();
                });
            });

        new Setting(containerEl)
            .setName('Debug logging')
            .setDesc(settingsSpec.debugLoggingDescription)
            .addToggle((toggle) => {
                toggle.setDisabled(!settingsSpec.supportsDebugLogging);
                toggle.setValue(this.getActiveProfile().debugLoggingEnabled).onChange(async (value) => {
                    if (!settingsSpec.supportsDebugLogging) {
                        return;
                    }
                    this.updateActiveProfile((profile) => ({
                        ...profile,
                        debugLoggingEnabled: value,
                    }));
                    await this.deps.saveNow();
                });
            });

        new Setting(containerEl)
            .setName('Tool extra args')
            .setDesc(settingsSpec.extraArgsDescription)
            .addTextArea((text) => {
                text.setPlaceholder(settingsSpec.extraArgsPlaceholder)
                    .setValue(this.getActiveProfile().extraArgs)
                    .onChange((value) => {
                        this.updateActiveProfile((profile) => ({
                            ...profile,
                            extraArgs: value,
                        }));
                        this.deps.saveDebounced();
                    });
                text.inputEl.rows = TOOL_EXTRA_ARGS_ROWS;
                text.inputEl.addClass('galdur-settings-input-full-width');
            });
    }

    private updateActiveProfile(mutator: (profile: ToolLaunchProfile) => ToolLaunchProfile): void {
        const toolId = this.deps.store.settings.activeToolId;
        const nextProfile = mutator(this.getActiveProfile());
        this.assignToolProfile(toolId, nextProfile);
    }

    private getActiveProfile(): ToolLaunchProfile {
        const toolId = this.deps.store.settings.activeToolId;
        const existing = this.deps.store.settings.toolProfiles[toolId];
        if (existing) {
            return existing;
        }

        const created = createDefaultToolProfile(toolId);
        this.setActiveProfile(toolId, created);
        return created;
    }

    private setActiveProfile<TToolId extends ToolId>(toolId: TToolId, profile: ToolLaunchProfile<TToolId>): void {
        this.assignToolProfile(toolId, profile);
    }

    private assignToolProfile<TToolId extends ToolId>(toolId: TToolId, profile: ToolLaunchProfile<TToolId>): void {
        setToolProfile(this.deps.store.settings.toolProfiles, toolId, profile);
    }

    private isActiveToolPermissionMode(value: string): value is ToolPermissionMode {
        const tool = requireTool(this.deps.store.settings.activeToolId);
        return tool.getSettingsSpec().permissionModes.some((mode) => mode.value === value);
    }
}
