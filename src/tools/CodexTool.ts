import { DEFAULT_TOOL_PROFILE } from '../constants';
import {
    CodexPermissionMode,
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    GaldurSettings,
    ToolExecutionContext,
    ToolPermissionModeOption,
    VaultPaths,
} from '../types';
import { resolveCommandWithContext } from '../services/executableResolver';
import { getToolLogPath } from './toolLogPath';
import { expandCommonPaths, makeCommonPaths, parseExtraArgs } from './toolHelpers';

const CODEX_TOOL_ID = 'codex';
const CODEX_DISPLAY_NAME = 'Codex';
const CODEX_OVERRIDE_ENV_VAR = 'GALDUR_CODEX_CMD';
const CODEX_BINARY = 'codex';
const CODEX_BINARY_CMD = 'codex.cmd';
const CODEX_BINARY_EXE = 'codex.exe';
const CODEX_DEBUG_LOG_FILE = 'codex-debug.log';
const CODEX_MISSING_CLI_HELP = `Set ${CODEX_OVERRIDE_ENV_VAR} or add Codex CLI to PATH, then restart Obsidian.`;

const CODEX_PATH_CANDIDATES = [CODEX_BINARY_CMD, CODEX_BINARY_EXE, CODEX_BINARY] as const;

const CODEX_COMMON_PATHS = makeCommonPaths(CODEX_BINARY_CMD, CODEX_BINARY_EXE);

const CODEX_PERMISSION_MODES: readonly ToolPermissionModeOption<CodexPermissionMode>[] = [
    { value: 'default', label: 'CLI default' },
    { value: 'readOnly', label: 'Read only' },
    { value: 'workspaceWrite', label: 'Workspace write' },
    { value: 'workspaceWriteNever', label: 'Workspace write, never ask' },
    { value: 'fullAuto', label: 'Full auto' },
    { value: 'dangerFullAccess', label: 'Danger full access' },
    { value: 'bypassApprovalsAndSandbox', label: 'Bypass approvals and sandbox' },
] as const;

const CODEX_PERMISSION_ARGS: Record<CodexPermissionMode, string[]> = {
    default: [],
    readOnly: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
    workspaceWrite: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
    workspaceWriteNever: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'],
    fullAuto: ['--full-auto'],
    dangerFullAccess: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'on-request'],
    bypassApprovalsAndSandbox: ['--dangerously-bypass-approvals-and-sandbox'],
};

export class CodexTool implements CliTool<'codex'> {
    public readonly id = CODEX_TOOL_ID;
    public readonly displayName = CODEX_DISPLAY_NAME;

    public async resolveCommand(context?: ToolExecutionContext): Promise<CommandResolution> {
        return resolveCommandWithContext(
            {
                overrideEnvVar: CODEX_OVERRIDE_ENV_VAR,
                pathCandidates: [...CODEX_PATH_CANDIDATES],
                commonPathCandidates: context?.wslEnabled ? [] : expandCommonPaths(CODEX_COMMON_PATHS),
                fallbackCommand: CODEX_BINARY,
            },
            context
        );
    }

    public getDebugLogPath(vaultPaths: VaultPaths): string {
        return getToolLogPath(vaultPaths, CODEX_DEBUG_LOG_FILE);
    }

    public buildArgs(settings: GaldurSettings): string[] {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        const permissionArgs = CODEX_PERMISSION_ARGS[profile.permissionMode] ?? CODEX_PERMISSION_ARGS.default;
        return [...permissionArgs, ...parseExtraArgs(profile.extraArgs)];
    }

    public getMissingCliHelp(): string {
        return CODEX_MISSING_CLI_HELP;
    }

    public getSettingsSpec(): CliToolSettingsSpec<'codex'> {
        return {
            permissionModeLabel: 'Permission preset',
            permissionModes: CODEX_PERMISSION_MODES,
            permissionModeDescription:
                'Uses Codex-native sandbox and approval presets before any extra args are appended.',
            supportsDebugLogging: false,
            debugLoggingDescription:
                'Codex does not expose a dedicated debug log file flag. Use Tool extra args for CLI-specific diagnostics.',
            extraArgsDescription: 'Optional extra args for Codex. One command fragment per line, e.g. --model gpt-5',
            extraArgsPlaceholder: '--model gpt-5\n--search',
        };
    }
}
