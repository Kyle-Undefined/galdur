import { DEFAULT_TOOL_PROFILE, TOOL_ARG_DEBUG_FILE, TOOL_ARG_PERMISSION_MODE } from '../constants';
import {
    ClaudePermissionMode,
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    GaldurSettings,
    ToolPermissionModeOption,
    VaultPaths,
} from '../types';
import { resolveExecutable } from '../services/executableResolver';
import { getToolLogPath } from './toolLogPath';
import { expandCommonPaths, parseExtraArgs } from './toolHelpers';

const CLAUDE_TOOL_ID = 'claude';
const CLAUDE_DISPLAY_NAME = 'Claude';
const CLAUDE_OVERRIDE_ENV_VAR = 'GALDUR_CLAUDE_CMD';
const CLAUDE_BINARY = 'claude';
const CLAUDE_BINARY_CMD = 'claude.cmd';
const CLAUDE_BINARY_EXE = 'claude.exe';
const CLAUDE_DEBUG_LOG_FILE = 'claude-debug.log';
const CLAUDE_MISSING_CLI_HELP = `Set ${CLAUDE_OVERRIDE_ENV_VAR} or add Claude Code CLI to PATH, then restart Obsidian.`;

const CLAUDE_PATH_NAMES_PREFER_CMD = [CLAUDE_BINARY_CMD, CLAUDE_BINARY_EXE] as const;
const CLAUDE_PATH_NAMES_PREFER_EXE = [CLAUDE_BINARY_EXE, CLAUDE_BINARY_CMD] as const;
const CLAUDE_PATH_CANDIDATES = [CLAUDE_BINARY_CMD, CLAUDE_BINARY_EXE, CLAUDE_BINARY] as const;

const CLAUDE_COMMON_PATHS = [
    { envVar: 'APPDATA', subPath: 'npm', names: CLAUDE_PATH_NAMES_PREFER_CMD },
    {
        envVar: 'USERPROFILE',
        subPath: '.local/bin',
        names: CLAUDE_PATH_NAMES_PREFER_EXE,
    },
    {
        envVar: 'USERPROFILE',
        subPath: '.bun/bin',
        names: CLAUDE_PATH_NAMES_PREFER_EXE,
    },
    {
        envVar: 'LOCALAPPDATA',
        subPath: 'pnpm',
        names: CLAUDE_PATH_NAMES_PREFER_CMD,
    },
] as const;

const CLAUDE_PERMISSION_MODES: readonly ToolPermissionModeOption<ClaudePermissionMode>[] = [
    { value: 'default', label: 'default' },
    { value: 'acceptEdits', label: 'acceptEdits' },
    { value: 'auto', label: 'auto' },
    { value: 'bypassPermissions', label: 'bypassPermissions' },
    { value: 'dontAsk', label: 'dontAsk' },
    { value: 'plan', label: 'plan' },
] as const;

export class ClaudeTool implements CliTool<'claude'> {
    public readonly id = CLAUDE_TOOL_ID;
    public readonly displayName = CLAUDE_DISPLAY_NAME;

    public async resolveCommand(): Promise<CommandResolution> {
        return await resolveExecutable({
            overrideEnvVar: CLAUDE_OVERRIDE_ENV_VAR,
            pathCandidates: [...CLAUDE_PATH_CANDIDATES],
            commonPathCandidates: expandCommonPaths(CLAUDE_COMMON_PATHS),
            fallbackCommand: CLAUDE_BINARY,
        });
    }

    public getDebugLogPath(vaultPaths: VaultPaths): string {
        return getToolLogPath(vaultPaths, CLAUDE_DEBUG_LOG_FILE);
    }

    public buildArgs(settings: GaldurSettings, debugFilePath?: string): string[] {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        const args: string[] = [];
        if (profile.debugLoggingEnabled && debugFilePath) {
            args.push(TOOL_ARG_DEBUG_FILE, debugFilePath);
        }
        const permissionMode = profile.permissionMode;
        if (permissionMode !== 'default') {
            args.push(TOOL_ARG_PERMISSION_MODE, permissionMode);
        }
        // Extra args are appended last and can override flags set above
        args.push(...parseExtraArgs(profile.extraArgs));
        return args;
    }

    public getMissingCliHelp(): string {
        return CLAUDE_MISSING_CLI_HELP;
    }

    public getSettingsSpec(): CliToolSettingsSpec<'claude'> {
        return {
            permissionModeLabel: 'Permission mode',
            permissionModes: CLAUDE_PERMISSION_MODES,
            permissionModeDescription: `Passed as ${TOOL_ARG_PERMISSION_MODE} when supported by ${this.displayName}.`,
            supportsDebugLogging: true,
            debugLoggingDescription:
                'When enabled, writes tool debug output to a debug log file in the plugin logs folder.',
            extraArgsDescription:
                'Optional extra args for the active tool. One command fragment per line, e.g. --model sonnet',
            extraArgsPlaceholder: '--model sonnet\n--append-system-prompt "Prefer small, focused diffs"',
        };
    }
}
