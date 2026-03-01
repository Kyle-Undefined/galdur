import { App, ItemView, WorkspaceLeaf } from "obsidian";
import { delimiter, dirname, isAbsolute } from "path";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { VIEW_TYPE_GALDUR } from "../constants";
import { CliSessionService } from "../services/CliSessionService";
import { PtyModuleService } from "../services/PtyModuleService";
import { GaldurViewContext } from "../types";
import { getTool } from "../tools/toolRegistry";

export class GaldurTerminalView extends ItemView {
  private context: GaldurViewContext;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private statusEl: HTMLSpanElement | null = null;
  private terminalHostEl: HTMLDivElement | null = null;
  private ptyModuleService = new PtyModuleService();
  private sessionService = new CliSessionService();

  public constructor(leaf: WorkspaceLeaf, context: GaldurViewContext) {
    super(leaf);
    this.context = context;
  }

  public getViewType(): string {
    return VIEW_TYPE_GALDUR;
  }

  public getDisplayText(): string {
    return "Galdur";
  }

  public getIcon(): string {
    return "terminal";
  }

  public async onOpen(): Promise<void> {
    this.render();
    this.startToolSession();
  }

  public async onClose(): Promise<void> {
    this.sessionService.stop();
    this.disposeTerminal();
  }

  public async restartSession(): Promise<void> {
    this.stopSessionInternal("[restarting session]");
    this.startToolSession();
  }

  public stopSession(): void {
    this.stopSessionInternal("[session stopped]");
  }

  private render(): void {
    this.contentEl.empty();
    const shellEl = this.contentEl.createDiv({ cls: "galdur-terminal-shell" });
    const toolbarEl = shellEl.createDiv({ cls: "galdur-terminal-toolbar" });
    this.statusEl = toolbarEl.createSpan({
      cls: "galdur-terminal-status",
      text: "Starting..."
    });

    const restartBtn = toolbarEl.createEl("button", {
      cls: "galdur-terminal-btn",
      text: "Restart"
    });
    restartBtn.addEventListener("click", () => {
      void this.restartSession();
    });

    const stopBtn = toolbarEl.createEl("button", {
      cls: "galdur-terminal-btn",
      text: "Stop"
    });
    stopBtn.addEventListener("click", () => {
      this.stopSession();
    });

    this.terminalHostEl = shellEl.createDiv({ cls: "galdur-terminal-host" });

    this.terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "Cascadia Code, JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: "#0f1117"
      }
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.open(this.terminalHostEl);
    this.fitAddon.fit();
    this.terminal.focus();
    this.terminal.writeln("Galdur terminal initialized.");

    this.terminal.onData((data) => {
      this.sessionService.write(data);
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fitAddon?.fit();
      this.resizeSessionToTerminal();
    });
    this.resizeObserver.observe(this.terminalHostEl);
  }

  private startToolSession(): void {
    if (!this.terminal) {
      return;
    }

    const settings = this.context.getSettings();
    const tool = getTool(settings.activeToolId);
    const vaultPath = this.getVaultPath(this.app);
    const ptyResolution = this.ptyModuleService.resolve(vaultPath);
    if (!ptyResolution.module) {
      this.setStatus("node-pty missing");
      this.terminal.writeln("\r\n[node-pty not found]\r\n");
      this.terminal.writeln(
        "Galdur could not load node-pty from Obsidian's runtime context.\r\n"
      );
      this.terminal.writeln("Checked module candidates:\r\n");
      for (const attempt of ptyResolution.attempts) {
        this.terminal.writeln(`- ${attempt}\r\n`);
      }
      this.terminal.writeln("Load errors:\r\n");
      for (const error of ptyResolution.errors) {
        this.terminal.writeln(`- ${error}\r\n`);
      }
      return;
    }

    const commandResolution = tool.resolveCommand();
    if (!commandResolution.found) {
      this.setStatus("CLI not found");
      this.terminal.writeln(`\r\n[${tool.displayName} executable not found]\r\n`);
      this.terminal.writeln(`${tool.getMissingCliHelp()}\r\n`);
      this.terminal.writeln("Checked:\r\n");
      for (const attempt of commandResolution.attempts) {
        this.terminal.writeln(`- ${attempt}\r\n`);
      }
      return;
    }

    const debugFilePath = tool.getDebugLogPath(vaultPath);
    const activeProfile =
      settings.toolProfiles[settings.activeToolId] ?? this.getDefaultProfile();
    const args = tool.buildArgs(
      settings,
      activeProfile.debugLoggingEnabled ? debugFilePath : undefined
    );

    this.terminal.writeln(
      `\r\nSpawning ${commandResolution.command} (${commandResolution.source}) in ${vaultPath}\r\n`
    );
    this.terminal.writeln(`Tool: ${tool.displayName}\r\n`);
    if (activeProfile.debugLoggingEnabled) {
      this.terminal.writeln(`Debug log: ${debugFilePath}\r\n`);
    } else {
      this.terminal.writeln("Debug logging: off\r\n");
    }
    this.setStatus("Running");

    const cols = Math.max(this.terminal.cols, 80);
    const rows = Math.max(this.terminal.rows, 24);

    const result = this.sessionService.start({
      ptyModule: ptyResolution.module,
      command: commandResolution.command,
      args,
      cwd: vaultPath,
      cols,
      rows,
      env: this.buildSpawnEnv(commandResolution.command),
      onData: (data) => {
        this.terminal?.write(data);
      },
      onExit: (event) => {
        this.setStatus("Stopped");
        this.terminal?.writeln(
          `\r\n[session exited] code=${event.exitCode} signal=${String(event.signal)}\r\n`
        );
      },
      onNoOutput: () => {
        this.setStatus("Running (no output)");
        this.terminal?.writeln(
          "\r\n[no PTY output after 8s; process is alive but has not drawn a UI yet]\r\n"
        );
        if (activeProfile.debugLoggingEnabled) {
          this.terminal?.writeln(`- debug log: ${debugFilePath}\r\n`);
        }
      }
    });

    if (!result.ok) {
      this.setStatus("Failed to start");
      this.terminal.writeln(`\r\n[spawn exception] ${String(result.error)}\r\n`);
      return;
    }

    this.terminal.writeln(`[pty started] pid=${result.pid}\r\n`);
  }

  private resizeSessionToTerminal(): void {
    if (!this.terminal) {
      return;
    }

    const cols = Math.max(this.terminal.cols, 2);
    const rows = Math.max(this.terminal.rows, 1);
    this.sessionService.resize(cols, rows);
  }

  private disposeTerminal(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.fitAddon?.dispose();
    this.fitAddon = null;

    this.terminal?.dispose();
    this.terminal = null;
  }

  private getVaultPath(app: App): string {
    const adapter = app.vault.adapter as { getBasePath?: () => string };
    if (adapter.getBasePath) {
      return adapter.getBasePath();
    }
    return process.cwd();
  }

  private setStatus(message: string): void {
    if (this.statusEl) {
      this.statusEl.setText(`Status: ${message}`);
    }
  }

  private stopSessionInternal(message: string): void {
    this.sessionService.stop();
    this.setStatus("Stopped");
    this.terminal?.writeln(`\r\n${message}\r\n`);
  }

  private getDefaultProfile(): {
    permissionMode: "default";
    extraArgs: "";
    debugLoggingEnabled: false;
  } {
    return {
      permissionMode: "default",
      extraArgs: "",
      debugLoggingEnabled: false
    };
  }

  private buildSpawnEnv(command: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: "xterm-256color"
    };

    const commandDir = this.getExecutableDir(command);
    if (!commandDir) {
      return env;
    }

    const pathKey = this.getPathEnvKey(env);
    const currentPath = env[pathKey] ?? "";
    if (this.pathContainsEntry(currentPath, commandDir)) {
      return env;
    }

    env[pathKey] = currentPath ? `${commandDir}${delimiter}${currentPath}` : commandDir;
    return env;
  }

  private getExecutableDir(command: string): string | null {
    const normalized = this.stripOuterQuotes(command.trim());
    if (!normalized) {
      return null;
    }
    if (!isAbsolute(normalized) && !normalized.includes("\\") && !normalized.includes("/")) {
      return null;
    }

    return dirname(normalized);
  }

  private getPathEnvKey(env: NodeJS.ProcessEnv): string {
    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
    if (existingKey) {
      return existingKey;
    }
    return process.platform === "win32" ? "Path" : "PATH";
  }

  private pathContainsEntry(pathValue: string, entry: string): boolean {
    const target = entry.toLowerCase();
    return pathValue
      .split(delimiter)
      .map((part) => part.trim().replace(/^"(.*)"$/, "$1").toLowerCase())
      .some((part) => part === target);
  }

  private stripOuterQuotes(value: string): string {
    if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
      return value.slice(1, -1);
    }
    return value;
  }
}
