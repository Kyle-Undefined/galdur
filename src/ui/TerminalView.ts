import { ItemView, setIcon, WorkspaceLeaf } from 'obsidian';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { TERMINAL_DEFAULTS, TERMINAL_RESIZE_DEBOUNCE_MS, TOOL_OPTIONS, VIEW_TYPE_GALDUR } from '../constants';
import { Manager } from '../services/runtime/Manager';
import { HostService } from '../services/runtime/HostService';
import { GaldurViewContext, ToolId } from '../types';
import { swallowError } from '../utils/logging';
import { getTool } from '../tools/toolRegistry';
import { TERMINAL_STATUS, TerminalSessionController } from './terminal/TerminalSessionController';

export class TerminalView extends ItemView {
    private context: GaldurViewContext;
    private settingsActionAdded = false;
    private terminal: Terminal | null = null;
    private fitAddon: FitAddon | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private resizeTimer: ReturnType<typeof setTimeout> | null = null;
    private terminalDataDisposable: { dispose(): void } | null = null;
    private statusEl: HTMLSpanElement | null = null;
    private toolSelectEl: HTMLSelectElement | null = null;
    private startBtnEl: HTMLButtonElement | null = null;
    private stopBtnEl: HTMLButtonElement | null = null;
    private settingsBtnEl: HTMLButtonElement | null = null;
    private terminalHostEl: HTMLDivElement | null = null;
    private readonly controller: TerminalSessionController;

    public constructor(
        leaf: WorkspaceLeaf,
        context: GaldurViewContext,
        runtimeManager: Manager,
        getRuntimeHost: () => HostService
    ) {
        super(leaf);
        this.context = context;
        this.controller = new TerminalSessionController({
            app: this.app,
            context: this.context,
            runtimeManager,
            getRuntimeHost,
            getTerminal: () => this.terminal,
            onStatusChange: (message) => this.setStatus(message),
            onControlsChange: () => this.syncControls(),
        });
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
        this.addSettingsAction();
        this.render();
        this.controller.onOpen();
    }

    public async onClose(): Promise<void> {
        await this.controller.onClose();
        this.disposeTerminal();
    }

    public async startSession(): Promise<void> {
        await this.controller.startSession();
    }

    public stopSession(): void {
        this.controller.stopSession();
    }

    private addSettingsAction(): void {
        if (this.settingsActionAdded) {
            return;
        }

        this.addAction('settings', 'Open Galdur settings', () => {
            this.context.openSettings();
        });
        this.settingsActionAdded = true;
    }

    private render(): void {
        this.disposeTerminal();
        this.contentEl.empty();
        const shellEl = this.contentEl.createDiv({ cls: 'galdur-terminal-shell' });
        const toolbarEl = shellEl.createDiv({ cls: 'galdur-terminal-toolbar' });
        const controlsEl = toolbarEl.createDiv({ cls: 'galdur-terminal-toolbar-controls' });
        const toolSelect = controlsEl.createEl('select', { cls: 'galdur-terminal-select' });
        for (const toolId of TOOL_OPTIONS) {
            const tool = getTool(toolId);
            if (!tool) {
                continue;
            }
            toolSelect.createEl('option', {
                value: toolId,
                text: tool.displayName,
            });
        }
        toolSelect.value = this.context.getSettings().activeToolId;
        toolSelect.addEventListener('change', () => {
            void this.handleToolSelection(toolSelect.value);
        });
        this.toolSelectEl = toolSelect;

        this.statusEl = toolbarEl.createSpan({
            cls: 'galdur-terminal-status',
            text: `Status: ${TERMINAL_STATUS.starting}`,
        });

        const actionsEl = toolbarEl.createDiv({ cls: 'galdur-terminal-toolbar-actions' });
        const startBtn = actionsEl.createEl('button', {
            cls: 'galdur-terminal-btn',
            text: 'Start',
        });
        startBtn.addEventListener('click', () => {
            void this.startSession();
        });
        this.startBtnEl = startBtn;

        const stopBtn = actionsEl.createEl('button', {
            cls: 'galdur-terminal-btn',
            text: 'Stop',
        });
        stopBtn.addEventListener('click', () => {
            this.stopSession();
        });
        this.stopBtnEl = stopBtn;

        const settingsBtn = actionsEl.createEl('button', {
            cls: 'galdur-terminal-icon-btn',
            attr: {
                type: 'button',
                'aria-label': 'Open Galdur settings',
                title: 'Open Galdur settings',
            },
        });
        setIcon(settingsBtn, 'settings');
        settingsBtn.addEventListener('click', () => {
            this.context.openSettings();
        });
        this.settingsBtnEl = settingsBtn;

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
            void this.controller.write(data).catch(swallowError);
        });

        this.resizeObserver = new ResizeObserver(() => {
            this.fitAddon?.fit();
            this.scheduleResizeSessionToTerminal();
        });
        this.resizeObserver.observe(this.terminalHostEl);
        this.syncControls();
    }

    private resizeSessionToTerminal(): void {
        if (!this.terminal) {
            return;
        }
        this.controller.resizeToTerminal(this.terminal.cols, this.terminal.rows);
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
        this.controller.clearResizeState();
        this.toolSelectEl = null;
        this.startBtnEl = null;
        this.stopBtnEl = null;
        this.settingsBtnEl = null;

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

    private clearResizeTimer(): void {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer);
            this.resizeTimer = null;
        }
    }

    private async handleToolSelection(value: string): Promise<void> {
        if (!this.isToolId(value) || this.controller.hasLiveSession()) {
            this.syncControls();
            return;
        }

        const settings = this.context.getSettings();
        if (settings.activeToolId === value) {
            return;
        }

        settings.activeToolId = value;
        await this.context.saveSettings();
    }

    private syncControls(): void {
        const hasLiveSession = this.controller.hasLiveSession();
        if (this.toolSelectEl) {
            this.toolSelectEl.value = this.context.getSettings().activeToolId;
            this.toolSelectEl.disabled = hasLiveSession;
            this.toolSelectEl.title = hasLiveSession ? 'Stop the session to switch tools' : '';
        }
        if (this.startBtnEl) {
            this.startBtnEl.disabled = hasLiveSession;
        }
        if (this.stopBtnEl) {
            this.stopBtnEl.disabled = !hasLiveSession;
        }
    }

    private isToolId(value: string): value is ToolId {
        return TOOL_OPTIONS.includes(value as ToolId);
    }
}
