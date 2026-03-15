import type { GaldurSettings, ToolId, ToolLaunchProfile, ToolPermissionModeMap } from './types';

export const VIEW_TYPE_GALDUR = 'galdur-terminal-view';
export const PLUGIN_ID = 'galdur';
export const RUNTIME_PROTOCOL_VERSION = 1;
export const RUNTIME_RELEASE_REPO = 'Kyle-Undefined/galdur';
export const RUNTIME_RELEASE_BASE_URL = `https://github.com/${RUNTIME_RELEASE_REPO}/releases/download`;
export const RUNTIME_CHECKSUM_FILE = 'galdur-runtime-checksums.txt';
export const RUNTIME_VERSION_METADATA_FILE = 'runtime-version.json';

// Runtime command surface
export const RUNTIME_AUTH_TOKEN_ENV_VAR = 'GALDUR_AUTH_TOKEN';
export const RUNTIME_ARG_PIPE_PATH = '--pipe-path';
export const RUNTIME_ARG_PROTOCOL_VERSION = '--protocol-version';
export const RUNTIME_ARG_VERSION = '--version';
export const RUNTIME_ARG_HEALTHCHECK = '--healthcheck';

export const PLUGINS_DIR = 'plugins';
export const NODE_MODULES_DIR = 'node_modules';
export const RUNTIME_DIR = 'runtime';
export const RUNTIME_DIST_DIR = 'dist';

export const TOOL_OPTIONS = ['claude', 'codex', 'gemini', 'opencode'] as const satisfies readonly ToolId[];
export const TOOL_ARG_DEBUG_FILE = '--debug-file';
export const TOOL_ARG_PERMISSION_MODE = '--permission-mode';

// Runtime timing
export const DEFAULT_CONNECT_TIMEOUT_MS = 4000;
export const MIN_CONNECT_TIMEOUT_MS = 1000;
export const MAX_CONNECT_TIMEOUT_MS = 30000;
export const STARTUP_TIMEOUT_MS = 8000;
export const COMMAND_LOOKUP_TIMEOUT_MS = 1200;
export const CONNECTION_RETRY_MS = 500;
export const CONNECTION_RETRY_BACKOFF_MS = 120;
export const STDERR_BUFFER_LIMIT = 3000;
export const IPC_MAX_LINE_LENGTH = 1024 * 1024; // 1 MB
export const ERROR_NOTICE_DURATION_MS = 10000;
export const MAX_CONNECTION_RETRY_BACKOFF_MS = 1000;
export const DEFAULT_EXEC_TIMEOUT_MS = 1500;
export const RUNTIME_VERSION_PROBE_TIMEOUT_MS = 8000;
export const SETTINGS_SAVE_DEBOUNCE_MS = 400;
export const TERMINAL_RESIZE_DEBOUNCE_MS = 150;
export const TOOL_EXTRA_ARGS_ROWS = 4;

// Terminal defaults
export const MIN_TERMINAL_COLS = 80;
export const MIN_TERMINAL_ROWS = 24;
export const TERM_ENV_VALUE = 'xterm-256color';
export const TERMINAL_DEFAULTS = {
    fontFamily: 'Cascadia Code, JetBrains Mono, Fira Code, Consolas, monospace',
    fontSize: 13,
    scrollback: 5000,
    background: '#0f1117',
} as const;

// Runtime install/download limits
export const SESSION_EARLY_EVENT_BUFFER_LIMIT = 256;
export const RM_MAX_RETRIES = 8;
export const RM_RETRY_DELAY_MS = 120;
export const DOWNLOAD_MAX_REDIRECTS = 5;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
export const EXTRACT_TIMEOUT_MS = 60_000;
export const CHECKSUM_SHA256_HEX_LENGTH = 64;
export const HTTP_REDIRECT_CODES = [301, 302, 307, 308] as const;
export const HTTP_SUCCESS_MIN = 200;
export const HTTP_SUCCESS_MAX_EXCLUSIVE = 300;
export const ALLOWED_DOWNLOAD_HOST_SUFFIXES = ['github.com', 'githubusercontent.com'] as const;

const DEFAULT_TOOL_PROFILE_BASE = {
    extraArgs: '',
    debugLoggingEnabled: false,
} as const;

const DEFAULT_PERMISSION_MODE: { [K in ToolId]: Extract<ToolPermissionModeMap[K], 'default'> } = {
    claude: 'default',
    codex: 'default',
    gemini: 'default',
    opencode: 'default',
};

export function createDefaultToolProfile<TToolId extends ToolId>(toolId: TToolId): ToolLaunchProfile<TToolId> {
    return {
        permissionMode: DEFAULT_PERMISSION_MODE[toolId],
        ...DEFAULT_TOOL_PROFILE_BASE,
    };
}

export const DEFAULT_TOOL_PROFILE: ToolLaunchProfile = {
    permissionMode: 'default',
    ...DEFAULT_TOOL_PROFILE_BASE,
};

export const DEFAULT_SETTINGS: GaldurSettings = {
    activeToolId: 'claude',
    toolProfiles: {
        claude: createDefaultToolProfile('claude'),
        codex: createDefaultToolProfile('codex'),
        gemini: createDefaultToolProfile('gemini'),
        opencode: createDefaultToolProfile('opencode'),
    },
    excludedNoteTags: [],
    runtimePath: '',
    runtimeVersion: null,
    runtimeAutoStart: true,
    runtimeConnectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
    wslEnabled: false,
    wslDistro: '',
};

export function isToolId(value: unknown): value is ToolId {
    return typeof value === 'string' && (TOOL_OPTIONS as readonly string[]).includes(value);
}
