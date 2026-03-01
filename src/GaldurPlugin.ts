import { Plugin } from "obsidian";
import { VIEW_TYPE_GALDUR } from "./constants";
import { DEFAULT_SETTINGS } from "./constants";
import { GaldurSettings, ToolId, ToolLaunchProfile } from "./types";
import { GaldurTerminalView } from "./ui/GaldurTerminalView";
import { GaldurSettingTab } from "./ui/GaldurSettingTab";
import xtermCssText from "@xterm/xterm/css/xterm.css";

export default class GaldurPlugin extends Plugin {
  private xtermStyleEl: HTMLStyleElement | null = null;
  public settings: GaldurSettings = { ...DEFAULT_SETTINGS };

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.installXtermCss();

    this.registerView(
      VIEW_TYPE_GALDUR,
      (leaf) =>
        new GaldurTerminalView(leaf, {
          getSettings: () => this.settings
        })
    );
    this.addSettingTab(new GaldurSettingTab(this.app, this));

    this.addRibbonIcon("terminal", "Open Galdur panel", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "toggle-galdur-panel",
      name: "Toggle Galdur panel",
      callback: () => {
        void this.toggleView();
      }
    });

    this.addCommand({
      id: "restart-galdur-session",
      name: "Restart Galdur session",
      callback: () => {
        void this.restartSession();
      }
    });

    this.addCommand({
      id: "stop-galdur-session",
      name: "Stop Galdur session",
      callback: () => {
        this.stopSession();
      }
    });
  }

  public onunload(): void {
    this.app.workspace
      .getLeavesOfType(VIEW_TYPE_GALDUR)
      .forEach((leaf) => leaf.detach());

    this.xtermStyleEl?.remove();
    this.xtermStyleEl = null;
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async loadSettings(): Promise<void> {
    type StoredSettings = Partial<GaldurSettings> & {
      activeToolId?: ToolId;
      toolProfiles?: Partial<Record<ToolId, Partial<ToolLaunchProfile>>>;
    };

    const loaded = (await this.loadData()) as StoredSettings | null;
    const loadedToolProfiles: Partial<
      Record<ToolId, Partial<ToolLaunchProfile>>
    > = loaded?.toolProfiles ?? {};

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded ?? {}),
      activeToolId: loaded?.activeToolId ?? DEFAULT_SETTINGS.activeToolId,
      toolProfiles: {
        ...DEFAULT_SETTINGS.toolProfiles,
        ...loadedToolProfiles,
        claude: {
          ...DEFAULT_SETTINGS.toolProfiles.claude,
          ...(loadedToolProfiles.claude ?? {})
        }
      }
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
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async restartSession(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR)[0];
    if (!leaf) {
      await this.activateView();
      return;
    }

    const view = leaf.view;
    if (view instanceof GaldurTerminalView) {
      await view.restartSession();
      await this.app.workspace.revealLeaf(leaf);
    }
  }

  private stopSession(): void {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GALDUR)[0];
    if (!leaf) {
      return;
    }

    const view = leaf.view;
    if (view instanceof GaldurTerminalView) {
      view.stopSession();
      void this.app.workspace.revealLeaf(leaf);
    }
  }

  private installXtermCss(): void {
    const styleId = "galdur-xterm-css";
    const existing = document.getElementById(styleId);
    if (existing instanceof HTMLStyleElement) {
      this.xtermStyleEl = existing;
      return;
    }

    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.setText(xtermCssText);
    document.head.appendChild(styleEl);
    this.xtermStyleEl = styleEl;
  }
}
