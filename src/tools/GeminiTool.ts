import { DEFAULT_TOOL_PROFILE } from '../constants';
import {
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    GaldurSettings,
    GeminiPermissionMode,
    ToolExecutionContext,
    ToolPermissionModeOption,
    VaultPaths,
} from '../types';
import { resolveCommandWithContext } from '../services/executableResolver';
import { getToolLogPath } from './toolLogPath';
import { expandCommonPaths, makeCommonPaths, parseExtraArgs } from './toolHelpers';

const GEMINI_TOOL_ID = 'gemini';
const GEMINI_DISPLAY_NAME = 'Gemini';
const GEMINI_OVERRIDE_ENV_VAR = 'GALDUR_GEMINI_CMD';
const GEMINI_BINARY = 'gemini';
const GEMINI_BINARY_CMD = 'gemini.cmd';
const GEMINI_BINARY_EXE = 'gemini.exe';
const GEMINI_DEBUG_LOG_FILE = 'gemini-debug.log';
const GEMINI_MISSING_CLI_HELP = `Set ${GEMINI_OVERRIDE_ENV_VAR} or add Gemini CLI to PATH, then restart Obsidian.`;

const GEMINI_PATH_CANDIDATES = [GEMINI_BINARY_CMD, GEMINI_BINARY_EXE, GEMINI_BINARY] as const;

const GEMINI_COMMON_PATHS = makeCommonPaths(GEMINI_BINARY_CMD, GEMINI_BINARY_EXE);

const GEMINI_PERMISSION_MODES: readonly ToolPermissionModeOption<GeminiPermissionMode>[] = [
    { value: 'default', label: 'CLI default' },
    { value: 'sandbox', label: 'Sandbox' },
    { value: 'autoEdit', label: 'Auto edit' },
    { value: 'sandboxAutoEdit', label: 'Sandbox + auto edit' },
    { value: 'plan', label: 'Plan' },
    { value: 'sandboxPlan', label: 'Sandbox + plan' },
    { value: 'yolo', label: 'YOLO' },
    { value: 'sandboxYolo', label: 'Sandbox + YOLO' },
] as const;

const GEMINI_PERMISSION_ARGS: Record<GeminiPermissionMode, string[]> = {
    default: [],
    sandbox: ['--sandbox'],
    autoEdit: ['--approval-mode', 'auto_edit'],
    sandboxAutoEdit: ['--sandbox', '--approval-mode', 'auto_edit'],
    plan: ['--approval-mode', 'plan'],
    sandboxPlan: ['--sandbox', '--approval-mode', 'plan'],
    yolo: ['--approval-mode', 'yolo'],
    sandboxYolo: ['--sandbox', '--approval-mode', 'yolo'],
};

export class GeminiTool implements CliTool<'gemini'> {
    public readonly id = GEMINI_TOOL_ID;
    public readonly displayName = GEMINI_DISPLAY_NAME;

    public async resolveCommand(context?: ToolExecutionContext): Promise<CommandResolution> {
        return resolveCommandWithContext(
            {
                overrideEnvVar: GEMINI_OVERRIDE_ENV_VAR,
                pathCandidates: [...GEMINI_PATH_CANDIDATES],
                commonPathCandidates: context?.wslEnabled ? [] : expandCommonPaths(GEMINI_COMMON_PATHS),
                fallbackCommand: GEMINI_BINARY,
            },
            context
        );
    }

    public getDebugLogPath(vaultPaths: VaultPaths): string {
        return getToolLogPath(vaultPaths, GEMINI_DEBUG_LOG_FILE);
    }

    public buildArgs(settings: GaldurSettings): string[] {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        const permissionArgs = GEMINI_PERMISSION_ARGS[profile.permissionMode] ?? GEMINI_PERMISSION_ARGS.default;
        return [...permissionArgs, ...parseExtraArgs(profile.extraArgs)];
    }

    public getMissingCliHelp(): string {
        return GEMINI_MISSING_CLI_HELP;
    }

    public getSettingsSpec(): CliToolSettingsSpec<'gemini'> {
        return {
            permissionModeLabel: 'Approval preset',
            permissionModes: GEMINI_PERMISSION_MODES,
            permissionModeDescription:
                'Uses Gemini CLI approval-mode and sandbox flags before any extra args are appended.',
            supportsDebugLogging: false,
            debugLoggingDescription:
                'Gemini CLI does not expose a dedicated debug log file flag. Use Tool extra args for CLI-specific diagnostics such as --debug.',
            extraArgsDescription:
                'Optional extra args for Gemini. One command fragment per line, e.g. --model gemini-2.5-pro',
            extraArgsPlaceholder: '--model gemini-2.5-pro\n--debug',
        };
    }
}
