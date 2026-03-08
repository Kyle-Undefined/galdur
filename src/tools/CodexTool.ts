import { join } from 'path';
import { DEFAULT_TOOL_PROFILE } from '../constants';
import {
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    GaldurSettings,
    ToolPermissionMode,
    VaultPaths,
} from '../types';
import { resolveExecutable } from '../services/executableResolver';
import { expandCommonPaths, parseExtraArgs } from './toolHelpers';

const CODEX_TOOL_ID = 'codex';
const CODEX_DISPLAY_NAME = 'Codex';
const CODEX_OVERRIDE_ENV_VAR = 'GALDUR_CODEX_CMD';
const CODEX_BINARY = 'codex';
const CODEX_BINARY_CMD = 'codex.cmd';
const CODEX_BINARY_EXE = 'codex.exe';
const CODEX_DEBUG_LOG_FILE = 'codex-debug.log';
const CODEX_MISSING_CLI_HELP = `Set ${CODEX_OVERRIDE_ENV_VAR} or add Codex CLI to PATH, then restart Obsidian.`;

const CODEX_PATH_NAMES_PREFER_CMD = [CODEX_BINARY_CMD, CODEX_BINARY_EXE] as const;
const CODEX_PATH_NAMES_PREFER_EXE = [CODEX_BINARY_EXE, CODEX_BINARY_CMD] as const;
const CODEX_PATH_CANDIDATES = [CODEX_BINARY_CMD, CODEX_BINARY_EXE, CODEX_BINARY] as const;

const CODEX_COMMON_PATHS = [
    { envVar: 'APPDATA', subPath: 'npm', names: CODEX_PATH_NAMES_PREFER_CMD },
    {
        envVar: 'USERPROFILE',
        subPath: '.local/bin',
        names: CODEX_PATH_NAMES_PREFER_EXE,
    },
    {
        envVar: 'USERPROFILE',
        subPath: '.bun/bin',
        names: CODEX_PATH_NAMES_PREFER_EXE,
    },
    {
        envVar: 'LOCALAPPDATA',
        subPath: 'pnpm',
        names: CODEX_PATH_NAMES_PREFER_CMD,
    },
] as const;

const CODEX_PERMISSION_ARGS: Record<ToolPermissionMode, string[]> = {
    default: [],
    acceptEdits: ['--full-auto'],
    bypassPermissions: ['--dangerously-bypass-approvals-and-sandbox'],
    delegate: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'on-request'],
    dontAsk: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'],
    plan: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
};

export class CodexTool implements CliTool {
    public readonly id = CODEX_TOOL_ID;
    public readonly displayName = CODEX_DISPLAY_NAME;

    public async resolveCommand(): Promise<CommandResolution> {
        return await resolveExecutable({
            overrideEnvVar: CODEX_OVERRIDE_ENV_VAR,
            pathCandidates: [...CODEX_PATH_CANDIDATES],
            commonPathCandidates: expandCommonPaths(CODEX_COMMON_PATHS),
            fallbackCommand: CODEX_BINARY,
        });
    }

    public getDebugLogPath(vaultPaths: VaultPaths): string {
        return join(vaultPaths.pluginDir, CODEX_DEBUG_LOG_FILE);
    }

    public buildArgs(settings: GaldurSettings): string[] {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        return [...CODEX_PERMISSION_ARGS[profile.permissionMode], ...parseExtraArgs(profile.extraArgs)];
    }

    public getMissingCliHelp(): string {
        return CODEX_MISSING_CLI_HELP;
    }

    public getSettingsSpec(): CliToolSettingsSpec {
        return {
            supportedPermissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'delegate', 'dontAsk', 'plan'],
            permissionModeDescription:
                'Translated to Codex sandbox and approval flags before any extra args are appended.',
            supportsDebugLogging: false,
            debugLoggingDescription:
                'Codex does not expose a dedicated debug log file flag. Use Tool extra args for CLI-specific diagnostics.',
            extraArgsDescription: 'Optional extra args for Codex. One command fragment per line, e.g. --model gpt-5',
            extraArgsPlaceholder: '--model gpt-5\n--search',
        };
    }
}
