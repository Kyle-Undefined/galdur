import { Setting } from 'obsidian';
import { parseConfiguredTagsInput } from '../../settings/settingsHelpers';
import { GaldurSettingsStore } from '../../types';

type ContextGuardSettingsSectionDeps = {
    store: GaldurSettingsStore;
    saveDebounced: () => void;
};

export class ContextGuardSettingsSection {
    public constructor(private readonly deps: ContextGuardSettingsSectionDeps) {}

    public render(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Context guard').setHeading();

        new Setting(containerEl)
            .setName('Excluded note tags')
            .setDesc(
                'Markdown notes with these tags are guarded globally. Claude uses generated deny rules, Gemini uses partial policy denies, and Codex/OpenCode are advisory only. One tag per line, without #.'
            )
            .addTextArea((text) => {
                text.setPlaceholder('sensitive\nprivate\ndraft')
                    .setValue(this.deps.store.settings.excludedNoteTags.join('\n'))
                    .onChange((value) => {
                        this.deps.store.settings.excludedNoteTags = parseConfiguredTagsInput(value);
                        this.deps.saveDebounced();
                    });
                text.inputEl.rows = 4;
                text.inputEl.addClass('galdur-settings-input-full-width');
            });
    }
}
