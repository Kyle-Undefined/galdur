import type { TerminalExitEvent } from '../../shared/ipc-types';
export type { TerminalExitEvent };

export type ParsedRuntimeArgs = {
    pipePath: string;
    authToken: string;
    protocolVersion: number;
    version: boolean;
    healthcheck: boolean;
};

export type Disposable = {
    dispose(): void;
};

export interface PtyProcess {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(): void;
    onData(listener: (data: string) => void): Disposable;
    onExit(listener: (event: TerminalExitEvent) => void): Disposable;
}

export interface PtyModule {
    spawn(
        command: string,
        args: string[],
        options: {
            name: string;
            useConpty: boolean;
            cwd: string;
            cols: number;
            rows: number;
            env: NodeJS.ProcessEnv;
        }
    ): PtyProcess;
}
