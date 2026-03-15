import { Terminal } from '@xterm/xterm';
import { RuntimeBackend, TerminalExitEvent } from '../../types';
import { PreparedToolLaunch, ToolSessionOrchestratorHooks } from './toolSessionOrchestrator';
import { writeNoOutputMessage, writeStartupBanner, writeToolMissingMessage } from './terminalMessages';

export type CreateTerminalSessionLaunchHooksArgs = {
    getTerminal: () => Terminal | null;
    getActiveBackend: () => RuntimeBackend | null;
    setActiveBackend: (backend: RuntimeBackend | null) => void;
    updateStatus: (status: string) => void;
    onControlsChange: () => void;
    onExit: (event: TerminalExitEvent) => void;
    vaultPath: string;
    runningStatus: string;
    runningNoOutputStatus: string;
    cliNotFoundStatus: string;
    stoppedStatus: string;
};

export function createTerminalSessionLaunchHooks(
    args: CreateTerminalSessionLaunchHooksArgs
): ToolSessionOrchestratorHooks {
    return {
        onCommandMissing: (missing) => {
            args.updateStatus(args.cliNotFoundStatus);
            const terminal = args.getTerminal();
            if (!terminal) {
                return;
            }
            writeToolMissingMessage(terminal, missing.toolDisplayName, missing.missingHelp, missing.attempts);
        },
        onPrepared: (launch) => {
            const terminal = args.getTerminal();
            if (!terminal) {
                return;
            }
            writePreparedLaunchBanner(terminal, launch, args.vaultPath);
            args.updateStatus(args.runningStatus);
        },
        onBackendCreated: (backend) => {
            args.setActiveBackend(backend);
        },
        onData: (data, backend) => {
            if (args.getActiveBackend() !== backend) {
                return;
            }
            args.getTerminal()?.write(data);
        },
        onExit: (event, backend) => {
            if (args.getActiveBackend() !== backend) {
                return;
            }
            args.setActiveBackend(null);
            args.updateStatus(args.stoppedStatus);
            args.onControlsChange();
            args.onExit(event);
        },
        onNoOutput: (launch, backend) => {
            const terminal = args.getTerminal();
            if (args.getActiveBackend() !== backend || !terminal) {
                return;
            }
            args.updateStatus(args.runningNoOutputStatus);
            writeNoOutputMessage(terminal, launch.startupTimeoutMs, launch.debugFilePath);
        },
    };
}

function writePreparedLaunchBanner(terminal: Terminal, launch: PreparedToolLaunch, vaultPath: string): void {
    writeStartupBanner(terminal, {
        command: launch.command,
        args: launch.args,
        commandSource: launch.commandSource,
        vaultPath,
        toolDisplayName: launch.toolDisplayName,
        debugLoggingEnabled: launch.debugLoggingEnabled,
        debugFilePath: launch.debugFilePath,
        contextGuard: launch.contextGuard,
    });
}
