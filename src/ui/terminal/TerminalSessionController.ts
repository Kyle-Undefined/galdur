import { App } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS } from '../../constants';
import { ContextGuardStalenessMonitor } from '../../services/context/ContextGuardStalenessMonitor';
import { TagContextGuardService } from '../../services/context/TagContextGuardService';
import { HostService } from '../../services/runtime/HostService';
import { Manager } from '../../services/runtime/Manager';
import { createBackend } from '../../services/runtime/createBackend';
import { GaldurViewContext, ResolvedContextGuard, RuntimeBackend } from '../../types';
import { swallowError } from '../../utils/logging';
import { getVaultPaths } from '../../utils/vault';
import { getTool } from '../../tools/toolRegistry';
import {
    writeContextGuardStaleWarning,
    writeNoOutputMessage,
    writeRuntimeSetupHint,
    writeStartupBanner,
    writeToolMissingMessage,
} from './terminalMessages';
import { orchestrateToolSessionLaunch } from './toolSessionOrchestrator';

export const TERMINAL_STATUS = {
    starting: 'Starting...',
    running: 'Running',
    runningNoOutput: 'Running (no output)',
    stopped: 'Stopped',
    failedToStart: 'Failed to start',
    cliNotFound: 'CLI not found',
    toolNotFound: 'Tool not found',
} as const;

const NON_DECORATED_STATUSES = new Set<string>([
    TERMINAL_STATUS.stopped,
    TERMINAL_STATUS.failedToStart,
    TERMINAL_STATUS.cliNotFound,
    TERMINAL_STATUS.toolNotFound,
]);

type TerminalSessionControllerDeps = {
    app: App;
    context: GaldurViewContext;
    runtimeManager: Manager;
    getRuntimeHost: () => HostService;
    getTerminal: () => Terminal | null;
    onStatusChange: (message: string) => void;
    onControlsChange: () => void;
};

export class TerminalSessionController {
    private activeBackend: RuntimeBackend | null = null;
    private startPromise: Promise<void> | null = null;
    private startGeneration = 0;
    private isClosed = false;
    private contextGuardStale = false;
    private sessionContextGuardSnapshot: Pick<ResolvedContextGuard, 'excludedTags' | 'excludedNotePaths'> | null = null;
    private lastSentResize: { cols: number; rows: number } | null = null;
    private currentStatus: string = TERMINAL_STATUS.stopped;
    private readonly contextGuardMonitor: ContextGuardStalenessMonitor;

    public constructor(private readonly deps: TerminalSessionControllerDeps) {
        this.contextGuardMonitor = new ContextGuardStalenessMonitor({
            app: deps.app,
            getSettings: () => this.deps.context.getSettings(),
            getSessionSnapshot: () => this.getActiveContextGuardSnapshot(),
            onStale: (current) => {
                this.handleContextGuardStale(current);
            },
        });
    }

    public onOpen(): void {
        this.isClosed = false;
        this.contextGuardMonitor.start();
        this.updateStatus(TERMINAL_STATUS.starting);
        void this.startToolSessionTracked().catch(swallowError);
    }

    public async onClose(): Promise<void> {
        this.isClosed = true;
        await this.stopActiveBackend();
        await this.startPromise?.catch(swallowError);
        this.startPromise = null;
        this.contextGuardMonitor.stop();
        this.clearResizeState();
    }

    public async startSession(): Promise<void> {
        if (this.isClosed || this.activeBackend) {
            return;
        }

        const pendingStart = this.startPromise;
        if (pendingStart) {
            await pendingStart.catch(swallowError);
            if (
                this.isClosed ||
                this.activeBackend ||
                (this.startPromise !== null && this.startPromise !== pendingStart)
            ) {
                return;
            }
        }

        this.updateStatus(TERMINAL_STATUS.starting);
        this.deps.onControlsChange();
        await this.startToolSessionTracked();
    }

    public stopSession(): void {
        void this.stopSessionInternal('[session stopped]');
    }

    public async write(data: string): Promise<void> {
        await this.activeBackend?.write(data);
    }

    public resizeToTerminal(cols: number, rows: number): void {
        if (!this.activeBackend) {
            return;
        }

        const nextCols = Math.max(cols, MIN_TERMINAL_COLS);
        const nextRows = Math.max(rows, MIN_TERMINAL_ROWS);
        if (this.lastSentResize && this.lastSentResize.cols === nextCols && this.lastSentResize.rows === nextRows) {
            return;
        }

        this.lastSentResize = { cols: nextCols, rows: nextRows };
        void this.activeBackend.resize(nextCols, nextRows).catch(swallowError);
    }

    public clearResizeState(): void {
        this.lastSentResize = null;
    }

    public hasLiveSession(): boolean {
        return this.activeBackend !== null || this.startPromise !== null;
    }

    public getCurrentStatus(): string {
        return this.decorateStatus(this.currentStatus);
    }

    private async startToolSession(): Promise<void> {
        const startId = ++this.startGeneration;
        const terminal = this.deps.getTerminal();
        if (!terminal) {
            return;
        }

        const settings = this.deps.context.getSettings();
        const tool = getTool(settings.activeToolId);
        if (!tool) {
            this.updateStatus(TERMINAL_STATUS.toolNotFound);
            terminal.writeln(`[error] Unknown tool: ${settings.activeToolId}`);
            return;
        }

        this.contextGuardStale = false;
        this.sessionContextGuardSnapshot = null;
        this.contextGuardMonitor.reset();
        const vaultPaths = getVaultPaths(this.deps.app);
        let contextGuard: ResolvedContextGuard;
        try {
            contextGuard = await new TagContextGuardService(this.deps.app).resolve(settings, vaultPaths, tool.id);
        } catch (error) {
            this.updateStatus(TERMINAL_STATUS.failedToStart);
            terminal.writeln('');
            terminal.writeln(`[context guard setup failed] ${String(error)}`);
            return;
        }

        this.sessionContextGuardSnapshot = {
            excludedTags: [...contextGuard.excludedTags],
            excludedNotePaths: [...contextGuard.excludedNotePaths],
        };
        const launchResult = await orchestrateToolSessionLaunch({
            settings,
            tool,
            vaultPaths,
            contextGuard,
            terminal: { cols: terminal.cols, rows: terminal.rows },
            createBackend: () => createBackend(this.deps.getRuntimeHost(), settings),
            isStale: () => this.isStartStale(startId),
            hooks: {
                onCommandMissing: (missing) => {
                    this.updateStatus(TERMINAL_STATUS.cliNotFound);
                    const activeTerminal = this.deps.getTerminal();
                    if (!activeTerminal) {
                        return;
                    }
                    writeToolMissingMessage(
                        activeTerminal,
                        missing.toolDisplayName,
                        missing.missingHelp,
                        missing.attempts
                    );
                },
                onPrepared: (launch) => {
                    const activeTerminal = this.deps.getTerminal();
                    if (!activeTerminal) {
                        return;
                    }
                    writeStartupBanner(activeTerminal, {
                        command: launch.command,
                        args: launch.args,
                        commandSource: launch.commandSource,
                        vaultPath: vaultPaths.vaultPath,
                        toolDisplayName: launch.toolDisplayName,
                        debugLoggingEnabled: launch.debugLoggingEnabled,
                        debugFilePath: launch.debugFilePath,
                        contextGuard: launch.contextGuard,
                    });
                    this.updateStatus(TERMINAL_STATUS.running);
                },
                onBackendCreated: (backend) => {
                    this.activeBackend = backend;
                },
                onData: (data, backend) => {
                    if (this.activeBackend !== backend) {
                        return;
                    }
                    this.deps.getTerminal()?.write(data);
                },
                onExit: (event, backend) => {
                    if (this.activeBackend !== backend) {
                        return;
                    }
                    this.activeBackend = null;
                    this.updateStatus(TERMINAL_STATUS.stopped);
                    this.deps.onControlsChange();
                    this.deps
                        .getTerminal()
                        ?.writeln(`[session exited] code=${event.exitCode} signal=${String(event.signal)}`);
                },
                onNoOutput: (launch, backend) => {
                    const activeTerminal = this.deps.getTerminal();
                    if (this.activeBackend !== backend || !activeTerminal) {
                        return;
                    }
                    this.updateStatus(TERMINAL_STATUS.runningNoOutput);
                    writeNoOutputMessage(activeTerminal, launch.startupTimeoutMs, launch.debugFilePath);
                },
            },
        });

        if (launchResult.kind === 'aborted' || launchResult.kind === 'missing-cli') {
            this.sessionContextGuardSnapshot = null;
            if (
                launchResult.kind === 'aborted' &&
                launchResult.backend &&
                this.activeBackend === launchResult.backend
            ) {
                await launchResult.backend.stop().catch(swallowError);
                this.activeBackend = null;
            }
            return;
        }

        if (launchResult.kind === 'failed') {
            this.sessionContextGuardSnapshot = null;
            if (this.activeBackend === launchResult.backend) {
                await launchResult.backend.stop().catch(swallowError);
                this.activeBackend = null;
            }
            this.updateStatus(TERMINAL_STATUS.failedToStart);
            terminal.writeln('');
            terminal.writeln(`[spawn exception] ${String(launchResult.error)}`);
            terminal.writeln('');
            writeRuntimeSetupHint(terminal, this.deps.runtimeManager.getResolvedRuntimePath(vaultPaths, settings));
            return;
        }

        if (this.activeBackend !== launchResult.backend) {
            await launchResult.backend.stop().catch(swallowError);
            return;
        }

        terminal.writeln(`[pty started] pid=${launchResult.pid}`);
    }

    private updateStatus(message: string): void {
        this.currentStatus = message;
        this.deps.onStatusChange(this.decorateStatus(message));
    }

    private decorateStatus(message: string): string {
        if (!this.contextGuardStale || message.includes('restart required')) {
            return message;
        }

        if (NON_DECORATED_STATUSES.has(message)) {
            return message;
        }

        return `${message} (restart required)`;
    }

    private async stopSessionInternal(message: string): Promise<void> {
        await this.stopActiveBackend();
        this.updateStatus(TERMINAL_STATUS.stopped);
        this.deps.onControlsChange();
        this.deps.getTerminal()?.writeln(message);
    }

    private async stopActiveBackend(): Promise<void> {
        this.startGeneration += 1;
        this.clearResizeState();
        this.contextGuardStale = false;
        this.sessionContextGuardSnapshot = null;
        this.contextGuardMonitor.reset();
        const backend = this.activeBackend;
        this.activeBackend = null;
        if (!backend) {
            this.deps.onControlsChange();
            return;
        }
        await backend.stop().catch(swallowError);
        this.deps.onControlsChange();
    }

    private startToolSessionTracked(): Promise<void> {
        const promise = this.startToolSession();
        this.startPromise = promise;
        this.deps.onControlsChange();
        return promise.finally(() => {
            if (this.startPromise === promise) {
                this.startPromise = null;
            }
            this.deps.onControlsChange();
        });
    }

    private isStartStale(startId: number): boolean {
        return this.isClosed || startId !== this.startGeneration;
    }

    private getActiveContextGuardSnapshot(): Pick<ResolvedContextGuard, 'excludedTags' | 'excludedNotePaths'> | null {
        if (this.sessionContextGuardSnapshot === null) {
            return null;
        }
        if (this.activeBackend === null && this.startPromise === null) {
            return null;
        }

        return this.sessionContextGuardSnapshot;
    }

    private handleContextGuardStale(current: Pick<ResolvedContextGuard, 'excludedTags' | 'excludedNotePaths'>): void {
        const terminal = this.deps.getTerminal();
        if (this.contextGuardStale || !terminal) {
            return;
        }

        const previousCount = this.sessionContextGuardSnapshot?.excludedNotePaths.length ?? 0;
        const currentCount = current.excludedNotePaths.length;
        this.contextGuardStale = true;
        writeContextGuardStaleWarning(terminal, previousCount, currentCount);
        if (this.activeBackend) {
            this.updateStatus(TERMINAL_STATUS.running);
            return;
        }
        if (this.startPromise) {
            this.updateStatus(TERMINAL_STATUS.starting);
        }
    }
}
