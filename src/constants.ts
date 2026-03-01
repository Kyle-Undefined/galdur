import { GaldurSettings, ToolId, ToolLaunchProfile, ToolPermissionMode } from "./types";

export const VIEW_TYPE_GALDUR = "galdur-terminal-view";
export const PLUGIN_ID = "galdur";

export const TOOL_OPTIONS: ToolId[] = ["claude"];

export const PERMISSION_MODE_OPTIONS: ToolPermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "delegate",
  "dontAsk",
  "plan"
];

const DEFAULT_TOOL_PROFILE: ToolLaunchProfile = {
  permissionMode: "default",
  extraArgs: "",
  debugLoggingEnabled: false
};

export const DEFAULT_SETTINGS: GaldurSettings = {
  activeToolId: "claude",
  toolProfiles: {
    claude: {
      ...DEFAULT_TOOL_PROFILE
    }
  }
};
