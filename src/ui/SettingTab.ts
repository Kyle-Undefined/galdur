import { App, Plugin, PluginSettingTab } from 'obsidian';
import { SETTINGS_SAVE_DEBOUNCE_MS } from '../constants';
import { Manager } from '../services/runtime/Manager';
import { GaldurSettingsStore } from '../types';
import { RuntimeSettingsSection } from './settings/RuntimeSettingsSection';
import { ToolSettingsSection } from './settings/ToolSettingsSection';

export class SettingTab extends PluginSettingTab {
    private readonly store: GaldurSettingsStore;
    private readonly toolSettingsSection: ToolSettingsSection;
    private readonly runtimeSettingsSection: RuntimeSettingsSection;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    public constructor(app: App, store: GaldurSettingsStore & Plugin, runtimeManager: Manager) {
        super(app, store);
        this.store = store;

        this.toolSettingsSection = new ToolSettingsSection({
            store: this.store,
            saveNow: async () => await this.store.saveSettings(),
            saveDebounced: () => this.debouncedSave(),
            refresh: () => this.display(),
        });

        this.runtimeSettingsSection = new RuntimeSettingsSection({
            app,
            store: this.store,
            plugin: store,
            runtimeManager,
            saveNow: async () => await this.store.saveSettings(),
            saveDebounced: () => this.debouncedSave(),
            refresh: () => this.display(),
        });
    }

    public display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.toolSettingsSection.render(containerEl);
        this.runtimeSettingsSection.render(containerEl);
    }

    public hide(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
            void this.store.saveSettings();
        }
    }

    private debouncedSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.store.saveSettings();
        }, SETTINGS_SAVE_DEBOUNCE_MS);
    }
}
