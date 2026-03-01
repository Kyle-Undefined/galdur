import { PtyModule } from "../types";

type SessionStartOptions = {
  ptyModule: PtyModule;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  onData: (data: string) => void;
  onExit: (event: { exitCode: number; signal?: number }) => void;
  onNoOutput: () => void;
};

type SessionStartResult =
  | { ok: true; pid: number }
  | { ok: false; error: unknown };

export class CliSessionService {
  private process: import("node-pty").IPty | null = null;
  private startupCheckTimer: ReturnType<typeof setTimeout> | null = null;

  public start(options: SessionStartOptions): SessionStartResult {
    this.stop();

    const timeoutMs = options.startupTimeoutMs ?? 8000;
    let sawOutput = false;

    try {
      this.process = options.ptyModule.spawn(options.command, options.args, {
        name: "xterm-256color",
        useConpty: false,
        cwd: options.cwd,
        cols: options.cols,
        rows: options.rows,
        env: options.env
      });
    } catch (error) {
      return { ok: false, error };
    }

    const pid = this.process.pid;

    const dataSubscription = this.process.onData((data) => {
      sawOutput = true;
      options.onData(data);
    });

    const exitSubscription = this.process.onExit((event) => {
      this.clearStartupTimer();
      dataSubscription.dispose();
      exitSubscription.dispose();
      this.process = null;
      options.onExit(event);
    });

    this.clearStartupTimer();
    this.startupCheckTimer = setTimeout(() => {
      if (!this.process || sawOutput) {
        return;
      }
      options.onNoOutput();
    }, timeoutMs);

    return { ok: true, pid };
  }

  public write(data: string): void {
    this.process?.write(data);
  }

  public resize(cols: number, rows: number): void {
    if (!this.process) {
      return;
    }

    try {
      this.process.resize(cols, rows);
    } catch {
      // Ignore resize errors during startup/shutdown race conditions.
    }
  }

  public stop(): void {
    this.clearStartupTimer();

    if (!this.process) {
      return;
    }

    try {
      this.process.kill();
    } catch {
      // Ignore kill failures during shutdown.
    }

    this.process = null;
  }

  private clearStartupTimer(): void {
    if (this.startupCheckTimer) {
      clearTimeout(this.startupCheckTimer);
      this.startupCheckTimer = null;
    }
  }
}
