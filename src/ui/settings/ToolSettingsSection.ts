import { Setting } from 'obsidian';
import {
    DEFAULT_TOOL_PROFILE,
    PERMISSION_MODE_OPTIONS,
    TOOL_ARG_PERMISSION_MODE,
    TOOL_EXTRA_ARGS_ROWS,
    TOOL_OPTIONS,
} from '../../constants';
import { getTool } from '../../tools/toolRegistry';
import { GaldurSettingsStore, ToolId, ToolLaunchProfile, ToolPermissionMode } from '../../types';

type ToolSettingsSectionDeps = {
    store: GaldurSettingsStore;
    saveNow: () => Promise<void>;
    saveDebounced: () => void;
    refresh: () => void;
};

export class ToolSettingsSection {
    public constructor(private readonly deps: ToolSettingsSectionDeps) {}

    public render(containerEl: HTMLElement): void {
        new Setting(containerEl)
            .setName('Active CLI tool')
            .setDesc('Tool opened in the Galdur terminal panel.')
            .addDropdown((dropdown) => {
                for (const toolId of TOOL_OPTIONS) {
                    const tool = getTool(toolId);
                    dropdown.addOption(toolId, tool.displayName);
                }
                dropdown.setValue(this.deps.store.settings.activeToolId).onChange(async (value) => {
                    if (!this.isToolId(value)) {
                        return;
                    }
                    this.deps.store.settings.activeToolId = value;
                    await this.deps.saveNow();
                    this.deps.refresh();
                });
            });

        new Setting(containerEl)
            .setName('Permission mode')
            .setDesc(`Passed as ${TOOL_ARG_PERMISSION_MODE} when supported by the active tool.`)
            .addDropdown((dropdown) => {
                for (const mode of PERMISSION_MODE_OPTIONS) {
                    dropdown.addOption(mode, mode);
                }
                dropdown.setValue(this.getActiveProfile().permissionMode).onChange(async (value) => {
                    if (!this.isPermissionMode(value)) {
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
            .setDesc('When enabled, writes tool debug output to a debug log file in the plugin folder.')
            .addToggle((toggle) => {
                toggle.setValue(this.getActiveProfile().debugLoggingEnabled).onChange(async (value) => {
                    this.updateActiveProfile((profile) => ({
                        ...profile,
                        debugLoggingEnabled: value,
                    }));
                    await this.deps.saveNow();
                });
            });

        new Setting(containerEl)
            .setName('Tool extra args')
            .setDesc('Optional extra args for the active tool. One command fragment per line, e.g. --model sonnet')
            .addTextArea((text) => {
                text.setPlaceholder('--model sonnet\n--arg2 value')
                    .setValue(this.getActiveProfile().extraArgs)
                    .onChange((value) => {
                        this.updateActiveProfile((profile) => ({
                            ...profile,
                            extraArgs: value,
                        }));
                        this.deps.saveDebounced();
                    });
                text.inputEl.rows = TOOL_EXTRA_ARGS_ROWS;
                text.inputEl.style.width = '100%';
            });
    }

    private updateActiveProfile(mutator: (profile: ToolLaunchProfile) => ToolLaunchProfile): void {
        const toolId = this.deps.store.settings.activeToolId;
        this.deps.store.settings.toolProfiles[toolId] = mutator(this.getActiveProfile());
    }

    private getActiveProfile(): ToolLaunchProfile {
        const toolId = this.deps.store.settings.activeToolId;
        const existing = this.deps.store.settings.toolProfiles[toolId];
        if (existing) {
            return existing;
        }

        const created: ToolLaunchProfile = { ...DEFAULT_TOOL_PROFILE };
        this.deps.store.settings.toolProfiles[toolId] = created;
        return created;
    }

    private isPermissionMode(value: string): value is ToolPermissionMode {
        return PERMISSION_MODE_OPTIONS.includes(value as ToolPermissionMode);
    }

    private isToolId(value: string): value is ToolId {
        return TOOL_OPTIONS.includes(value as ToolId);
    }
}
