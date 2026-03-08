import { ItemView, WorkspaceLeaf } from 'obsidian';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import {
    MIN_TERMINAL_COLS,
    MIN_TERMINAL_ROWS,
    TERMINAL_DEFAULTS,
    TERMINAL_RESIZE_DEBOUNCE_MS,
    VIEW_TYPE_GALDUR,
} from '../constants';
import { Manager } from '../services/runtime/Manager';
import { HostService } from '../services/runtime/HostService';
import { createBackend } from '../services/runtime/createBackend';
import { GaldurViewContext, RuntimeBackend } from '../types';
import { swallowError } from '../utils/logging';
import { getVaultPaths } from '../utils/vault';
import { getTool } from '../tools/toolRegistry';
import {
    writeNoOutputMessage,
    writeRuntimeSetupHint,
    writeStartupBanner,
    writeToolMissingMessage,
} from './terminal/terminalMessages';
import { orchestrateToolSessionLaunch } from './terminal/toolSessionOrchestrator';

export class TerminalView extends ItemView {
    private context: GaldurViewContext;
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSentResize: { cols: number; rows: number } | null = null;
    private terminalDataDisposable: { dispose(): void } | null = null;
    private statusEl: HTMLSpanElement | null = null;
    private terminalHostEl: HTMLDivElement | null = null;
    private activeBackend: RuntimeBackend | null = null;
    private startPromise: Promise<void> | null = null;
    private startGeneration = 0;
    private isClosed = false;
    private readonly runtimeManager: Manager;
    private readonly getRuntimeHost: () => HostService;

    public constructor(
        leaf: WorkspaceLeaf,
        context: GaldurViewContext,
        runtimeManager: Manager,
        getRuntimeHost: () => HostService
    ) {
        super(leaf);
        this.context = context;
        this.runtimeManager = runtimeManager;
        this.getRuntimeHost = getRuntimeHost;
    }

    public getViewType(): string {
        return VIEW_TYPE_GALDUR;
    }

    public getDisplayText(): string {
        return 'Galdur';
    }

    public getIcon(): string {
        return 'terminal';
    }

    public async onOpen(): Promise<void> {
        this.isClosed = false;
        this.render();
        void this.startToolSessionTracked().catch(swallowError);
    }

    public async onClose(): Promise<void> {
        this.isClosed = true;
        await this.stopActiveBackend();
        await this.startPromise?.catch(swallowError);
        this.startPromise = null;
        this.disposeTerminal();
    }

    public async restartSession(): Promise<void> {
        if (this.isClosed) {
            return;
        }
        await this.stopSessionInternal('[restarting session]');
        if (this.isClosed) {
            return;
        }
        await this.startToolSessionTracked();
    }

    public stopSession(): void {
        void this.stopSessionInternal('[session stopped]');
    }

    private render(): void {
        this.contentEl.empty();
        const shellEl = this.contentEl.createDiv({ cls: 'galdur-terminal-shell' });
        const toolbarEl = shellEl.createDiv({ cls: 'galdur-terminal-toolbar' });
        this.statusEl = toolbarEl.createSpan({
            cls: 'galdur-terminal-status',
            text: 'Starting...',
        });

        const restartBtn = toolbarEl.createEl('button', {
            cls: 'galdur-terminal-btn',
            text: 'Restart',
        });
        restartBtn.addEventListener('click', () => {
            void this.restartSession();
        });

        const stopBtn = toolbarEl.createEl('button', {
            cls: 'galdur-terminal-btn',
            text: 'Stop',
        });
        stopBtn.addEventListener('click', () => {
            this.stopSession();
        });

        this.terminalHostEl = shellEl.createDiv({ cls: 'galdur-terminal-host' });

        this.terminal = new Terminal({
            convertEol: true,
            cursorBlink: true,
            fontFamily: TERMINAL_DEFAULTS.fontFamily,
            fontSize: TERMINAL_DEFAULTS.fontSize,
            scrollback: TERMINAL_DEFAULTS.scrollback,
            theme: {
                background: TERMINAL_DEFAULTS.background,
            },
        });

        this.fitAddon = new FitAddon();
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.open(this.terminalHostEl);
        this.fitAddon.fit();
        this.terminal.focus();
        this.terminal.writeln('Galdur terminal initialized.');

        this.terminalDataDisposable = this.terminal.onData((data) => {
            void this.activeBackend?.write(data).catch(swallowError);
        });

        this.resizeObserver = new ResizeObserver(() => {
            this.fitAddon?.fit();
            this.scheduleResizeSessionToTerminal();
        });
        this.resizeObserver.observe(this.terminalHostEl);
    }

    private async startToolSession(): Promise<void> {
        const startId = ++this.startGeneration;
        if (!this.terminal) {
            return;
        }

        const settings = this.context.getSettings();
        const tool = getTool(settings.activeToolId);
        const vaultPaths = getVaultPaths(this.app);
        const launchResult = await orchestrateToolSessionLaunch({
            settings,
            tool,
            vaultPaths,
            terminal: { cols: this.terminal.cols, rows: this.terminal.rows },
            createBackend: () => createBackend(this.getRuntimeHost(), settings),
            isStale: () => this.isStartStale(startId),
            hooks: {
                onCommandMissing: (missing) => {
                    this.setStatus('CLI not found');
                    if (!this.terminal) {
                        return;
                    }
                    writeToolMissingMessage(
                        this.terminal,
                        missing.toolDisplayName,
                        missing.missingHelp,
                        missing.attempts
                    );
                },
                onPrepared: (launch) => {
                    if (!this.terminal) {
                        return;
                    }
                    writeStartupBanner(this.terminal, {
                        command: launch.command,
                        commandSource: launch.commandSource,
                        vaultPath: vaultPaths.vaultPath,
                        toolDisplayName: launch.toolDisplayName,
                        debugFilePath: launch.debugFilePath,
                    });
                    this.setStatus('Running');
                },
                onBackendCreated: (backend) => {
                    this.activeBackend = backend;
                },
                onData: (data, backend) => {
                    if (this.activeBackend !== backend) {
                        return;
                    }
                    this.terminal?.write(data);
                },
                onExit: (event, backend) => {
                    if (this.activeBackend !== backend) {
                        return;
                    }
                    this.activeBackend = null;
                    this.setStatus('Stopped');
                    this.terminal?.writeln(`[session exited] code=${event.exitCode} signal=${String(event.signal)}`);
                },
                onNoOutput: (launch, backend) => {
                    if (this.activeBackend !== backend || !this.terminal) {
                        return;
                    }
                    this.setStatus('Running (no output)');
                    writeNoOutputMessage(this.terminal, launch.startupTimeoutMs, launch.debugFilePath);
                },
            },
        });

        if (launchResult.kind === 'aborted' || launchResult.kind === 'missing-cli') {
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
            if (this.activeBackend === launchResult.backend) {
                this.activeBackend = null;
            }
            this.setStatus('Failed to start');
            this.terminal.writeln('');
            this.terminal.writeln(`[spawn exception] ${String(launchResult.error)}`);
            this.terminal.writeln('');
            writeRuntimeSetupHint(this.terminal, this.runtimeManager.getResolvedRuntimePath(vaultPaths, settings));
            return;
        }

        if (this.activeBackend !== launchResult.backend) {
            await launchResult.backend.stop().catch(swallowError);
            return;
        }

        this.terminal.writeln(`[pty started] pid=${launchResult.pid}`);
    }

    private resizeSessionToTerminal(): void {
        if (!this.terminal || !this.activeBackend) {
            return;
        }

        const cols = Math.max(this.terminal.cols, MIN_TERMINAL_COLS);
        const rows = Math.max(this.terminal.rows, MIN_TERMINAL_ROWS);
        if (this.lastSentResize && this.lastSentResize.cols === cols && this.lastSentResize.rows === rows) {
            return;
        }

        this.lastSentResize = { cols, rows };
        void this.activeBackend.resize(cols, rows).catch(swallowError);
    }

    private scheduleResizeSessionToTerminal(): void {
        this.clearResizeTimer();
        this.resizeTimer = setTimeout(() => {
            this.resizeTimer = null;
            this.resizeSessionToTerminal();
        }, TERMINAL_RESIZE_DEBOUNCE_MS);
    }

    private disposeTerminal(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.clearResizeTimer();
        this.lastSentResize = null;

        this.terminalDataDisposable?.dispose();
        this.terminalDataDisposable = null;

        this.fitAddon?.dispose();
        this.fitAddon = null;

        this.terminal?.dispose();
        this.terminal = null;
    }

    private setStatus(message: string): void {
        if (this.statusEl) {
            this.statusEl.setText(`Status: ${message}`);
        }
    }

    private async stopSessionInternal(message: string): Promise<void> {
        await this.stopActiveBackend();
        this.setStatus('Stopped');
        this.terminal?.writeln(`${message}`);
    }

    private async stopActiveBackend(): Promise<void> {
        this.startGeneration += 1;
        this.clearResizeTimer();
        this.lastSentResize = null;
        const backend = this.activeBackend;
        this.activeBackend = null;
        if (!backend) {
            return;
        }
        await backend.stop().catch(swallowError);
    }

    private clearResizeTimer(): void {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        }
    }

    private startToolSessionTracked(): Promise<void> {
        const promise = this.startToolSession();
        this.startPromise = promise;
        return promise.finally(() => {
            if (this.startPromise === promise) {
                this.startPromise = null;
            }
        });
    }

    private isStartStale(startId: number): boolean {
        return this.isClosed || startId !== this.startGeneration;
    }
}
