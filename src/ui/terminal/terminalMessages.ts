import { Terminal } from '@xterm/xterm';

export type StartupBannerArgs = {
    command: string;
    commandSource: string;
    vaultPath: string;
    toolDisplayName: string;
    debugFilePath?: string;
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

export function writeStartupBanner(terminal: Terminal, args: StartupBannerArgs): void {
    terminal.writeln(`Spawning ${args.command} (${args.commandSource}) in ${args.vaultPath}`);
    terminal.writeln(`Tool: ${args.toolDisplayName}`);
    if (args.debugFilePath) {
        terminal.writeln(`Debug log: ${args.debugFilePath}`);
    } else {
        terminal.writeln('Debug logging: off');
    }
}

export function writeNoOutputMessage(terminal: Terminal, startupTimeoutMs: number, debugFilePath?: string): void {
    terminal.writeln(
        `[no PTY output after ${(startupTimeoutMs / 1000).toFixed(1)}s; process is alive but has not drawn a UI yet]`
    );
    if (debugFilePath) {
        terminal.writeln(`- debug log: ${debugFilePath}`);
    }
}

export function writeRuntimeSetupHint(terminal: Terminal, runtimePath: string): void {
    terminal.writeln('[Runtime setup required]');
    terminal.writeln("Open Settings -> Galdur and click 'Install runtime', then start the session.");
    terminal.writeln(`Expected runtime path: ${runtimePath}`);
}
