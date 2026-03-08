import { Terminal } from '@xterm/xterm';
import { formatArgsForDisplay } from '../../tools/toolHelpers';
import { ContextGuardSupportLevel } from '../../types';

export type StartupBannerArgs = {
    command: string;
    args: string[];
    commandSource: string;
    vaultPath: string;
    toolDisplayName: string;
    debugLoggingEnabled: boolean;
    debugFilePath?: string;
    contextGuard?: {
        excludedTags: string[];
        excludedNotePaths: string[];
        supportLevel: ContextGuardSupportLevel;
        supportMessage: string;
    };
};

const DEFAULT_CONTEXT_GUARD = {
    excludedTags: [],
    excludedNotePaths: [],
    supportLevel: 'none',
    supportMessage: 'Global tag guard is off.',
} as const satisfies {
    excludedTags: readonly string[];
    excludedNotePaths: readonly string[];
    supportLevel: ContextGuardSupportLevel;
    supportMessage: string;
};

export function writeToolMissingMessage(
    terminal: Terminal,
    toolDisplayName: string,
    missingHelp: string,
    attempts: string[]
): void {
    terminal.writeln('');
    terminal.writeln(`[${toolDisplayName} executable not found]`);
    terminal.writeln(missingHelp);
    terminal.writeln('Checked:');
    for (const attempt of attempts) {
        terminal.writeln(`- ${attempt}`);
    }
}

export function writeStartupBanner(terminal: Terminal, config: StartupBannerArgs): void {
    const contextGuard = config.contextGuard ?? DEFAULT_CONTEXT_GUARD;
    const guardedNoteLabel = contextGuard.excludedNotePaths.length === 1 ? 'note' : 'notes';
    const guardedTagLabel = contextGuard.excludedTags.length === 1 ? 'tag' : 'tags';
    terminal.writeln(`Spawning ${config.command} (${config.commandSource}) in ${config.vaultPath}`);
    terminal.writeln(`Tool: ${config.toolDisplayName}`);
    if (config.debugLoggingEnabled) {
        terminal.writeln(`Args: ${formatArgsForDisplay(config.args)}`);
    } else {
        terminal.writeln('Args: hidden (enable debug logging to display launch args)');
    }
    if (config.debugFilePath) {
        terminal.writeln(`Debug log: ${config.debugFilePath}`);
    } else {
        terminal.writeln('Debug logging: off');
    }
    terminal.writeln(
        `Context guard: ${contextGuard.supportLevel} (${contextGuard.excludedTags.length} ${guardedTagLabel}, ${contextGuard.excludedNotePaths.length} ${guardedNoteLabel})`
    );
    terminal.writeln(`Context guard detail: ${contextGuard.supportMessage}`);
}

export function writeNoOutputMessage(terminal: Terminal, startupTimeoutMs: number, debugFilePath?: string): void {
    terminal.writeln(
        `[no PTY output after ${(startupTimeoutMs / 1000).toFixed(1)}s; process is alive but has not drawn a UI yet]`
    );
    if (debugFilePath) {
        terminal.writeln(`- debug log: ${debugFilePath}`);
    }
}

export function writeContextGuardStaleWarning(terminal: Terminal, previousCount: number, currentCount: number): void {
    terminal.writeln('');
    terminal.writeln('[context guard changed]');
    const prevLabel = previousCount === 1 ? 'note' : 'notes';
    const currLabel = currentCount === 1 ? 'note' : 'notes';
    terminal.writeln(`Excluded note set changed from ${previousCount} ${prevLabel} to ${currentCount} ${currLabel}.`);
    terminal.writeln('Restart the Galdur session to apply updated exclusions.');
}

export function writeRuntimeSetupHint(terminal: Terminal, runtimePath: string): void {
    terminal.writeln('[Runtime setup required]');
    terminal.writeln("Open Settings -> Galdur and click 'Install runtime', then start the session.");
    terminal.writeln(`Expected runtime path: ${runtimePath}`);
}
