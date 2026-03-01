import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
  PERMISSION_MODE_OPTIONS,
  TOOL_OPTIONS
} from "../constants";
import {
  GaldurSettingsStore,
  ToolId,
  ToolLaunchProfile,
  ToolPermissionMode
} from "../types";
import { getTool } from "../tools/toolRegistry";

export class GaldurSettingTab extends PluginSettingTab {
  private store: GaldurSettingsStore;

  public constructor(app: App, store: GaldurSettingsStore & Plugin) {
    super(app, store);
    this.store = store;
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Active CLI tool")
      .setDesc("Tool opened in the Galdur terminal panel.")
      .addDropdown((dropdown) => {
        for (const toolId of TOOL_OPTIONS) {
          const tool = getTool(toolId);
          dropdown.addOption(toolId, tool.displayName);
        }
        dropdown
          .setValue(this.store.settings.activeToolId)
          .onChange(async (value) => {
            if (!this.isToolId(value)) {
              return;
            }
            this.store.settings.activeToolId = value;
            await this.store.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc(
        "Passed as --permission-mode when supported by the active tool."
      )
      .addDropdown((dropdown) => {
        for (const mode of PERMISSION_MODE_OPTIONS) {
          dropdown.addOption(mode, mode);
        }
        dropdown
          .setValue(this.getActiveProfile().permissionMode)
          .onChange(async (value) => {
            if (!this.isPermissionMode(value)) {
              return;
            }
            const profile = this.getActiveProfile();
            this.store.settings.toolProfiles[this.store.settings.activeToolId] =
              {
                ...profile,
                permissionMode: value
              };
            await this.store.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc(
        "When enabled, writes tool debug output to a debug log file in the plugin folder."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.getActiveProfile().debugLoggingEnabled)
          .onChange(async (value) => {
            const profile = this.getActiveProfile();
            this.store.settings.toolProfiles[this.store.settings.activeToolId] =
              {
                ...profile,
                debugLoggingEnabled: value
              };
            await this.store.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Tool extra args")
      .setDesc(
        "Optional extra args for the active tool. One command fragment per line, e.g. --model sonnet"
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("--model sonnet\n--arg2 value")
          .setValue(this.getActiveProfile().extraArgs)
          .onChange(async (value) => {
            const profile = this.getActiveProfile();
            this.store.settings.toolProfiles[this.store.settings.activeToolId] =
              {
                ...profile,
                extraArgs: value
              };
            await this.store.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.style.width = "100%";
      });
  }

  private isPermissionMode(value: string): value is ToolPermissionMode {
    return PERMISSION_MODE_OPTIONS.includes(value as ToolPermissionMode);
  }

  private isToolId(value: string): value is ToolId {
    return TOOL_OPTIONS.includes(value as ToolId);
  }

  private getActiveProfile(): ToolLaunchProfile {
    const toolId = this.store.settings.activeToolId;
    const existing = this.store.settings.toolProfiles[toolId];
    if (existing) {
      return existing;
    }

    const created: ToolLaunchProfile = {
      permissionMode: "default",
      extraArgs: "",
      debugLoggingEnabled: false
    };
    this.store.settings.toolProfiles[toolId] = created;
    return created;
  }
}
