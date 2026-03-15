import { DEFAULT_TOOL_PROFILE } from '../constants';
import {
    CliTool,
    CliToolSettingsSpec,
    CommandResolution,
    GaldurSettings,
    OpenCodePermissionMode,
    ToolExecutionContext,
    ToolPermissionModeOption,
    VaultPaths,
} from '../types';
import { resolveCommandWithContext } from '../services/executableResolver';
import { expandCommonPaths, makeCommonPaths, parseExtraArgs } from './toolHelpers';

const OPENCODE_TOOL_ID = 'opencode';
const OPENCODE_DISPLAY_NAME = 'OpenCode';
const OPENCODE_OVERRIDE_ENV_VAR = 'GALDUR_OPENCODE_CMD';
const OPENCODE_BINARY = 'opencode';
const OPENCODE_BINARY_CMD = 'opencode.cmd';
const OPENCODE_BINARY_EXE = 'opencode.exe';
const OPENCODE_PERMISSION_ENV_VAR = 'OPENCODE_PERMISSION';
const OPENCODE_MISSING_CLI_HELP = `Set ${OPENCODE_OVERRIDE_ENV_VAR} or add OpenCode CLI to PATH, then restart Obsidian.`;

const OPENCODE_PATH_CANDIDATES = [OPENCODE_BINARY_CMD, OPENCODE_BINARY_EXE, OPENCODE_BINARY] as const;

const OPENCODE_COMMON_PATHS = makeCommonPaths(OPENCODE_BINARY_CMD, OPENCODE_BINARY_EXE);

const OPENCODE_PERMISSION_MODES: readonly ToolPermissionModeOption<OpenCodePermissionMode>[] = [
    { value: 'default', label: 'CLI default' },
    { value: 'askOnEditAndBash', label: 'Ask on edit + bash' },
    { value: 'readOnly', label: 'Read only' },
    { value: 'askAll', label: 'Ask everything' },
    { value: 'allowAll', label: 'Allow all' },
] as const;

export class OpenCodeTool implements CliTool<'opencode'> {
    public readonly id = OPENCODE_TOOL_ID;
    public readonly displayName = OPENCODE_DISPLAY_NAME;

    public async resolveCommand(context?: ToolExecutionContext): Promise<CommandResolution> {
        return resolveCommandWithContext(
            {
                overrideEnvVar: OPENCODE_OVERRIDE_ENV_VAR,
                pathCandidates: [...OPENCODE_PATH_CANDIDATES],
                commonPathCandidates: context?.wslEnabled ? [] : expandCommonPaths(OPENCODE_COMMON_PATHS),
                fallbackCommand: OPENCODE_BINARY,
            },
            context
        );
    }

    public getDebugLogPath(_vaultPaths: VaultPaths): string {
        return '';
    }

    public buildArgs(settings: GaldurSettings): string[] {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        return parseExtraArgs(profile.extraArgs);
    }

    public getSpawnEnvOverrides(settings: GaldurSettings): NodeJS.ProcessEnv | undefined {
        const profile = settings.toolProfiles[this.id] ?? DEFAULT_TOOL_PROFILE;
        const { permissionMode } = profile;
        if (permissionMode === 'default') {
            return undefined;
        }

        return {
            [OPENCODE_PERMISSION_ENV_VAR]: getPermissionEnvValue(permissionMode),
        };
    }

    public getMissingCliHelp(): string {
        return OPENCODE_MISSING_CLI_HELP;
    }

    public getSettingsSpec(): CliToolSettingsSpec<'opencode'> {
        return {
            permissionModeLabel: 'Permission preset',
            permissionModes: OPENCODE_PERMISSION_MODES,
            permissionModeDescription:
                'Uses OpenCode permissions by setting OPENCODE_PERMISSION to inline JSON before launch.',
            supportsDebugLogging: false,
            debugLoggingDescription:
                'OpenCode does not expose a dedicated debug log file flag. Use Tool extra args such as --print-logs or --log-level DEBUG.',
            extraArgsDescription:
                'Optional extra args for OpenCode. One command fragment per line, e.g. --model provider/model',
            extraArgsPlaceholder: '--model provider/model\n--print-logs\n--log-level DEBUG',
        };
    }
}

function getPermissionEnvValue(mode: Exclude<OpenCodePermissionMode, 'default'>): string {
    switch (mode) {
        case 'askOnEditAndBash':
            return JSON.stringify({ edit: 'ask', bash: 'ask' });
        case 'readOnly':
            return JSON.stringify({ edit: 'deny', bash: 'ask' });
        case 'askAll':
            return JSON.stringify({ '*': 'ask', external_directory: 'ask', doom_loop: 'ask' });
        case 'allowAll':
            return JSON.stringify({ '*': 'allow', external_directory: 'allow', doom_loop: 'allow' });
    }

    return assertNever(mode);
}

function assertNever(value: never): never {
    throw new Error(`Unhandled OpenCode permission mode: ${String(value)}`);
}
