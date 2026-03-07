import { ChildProcess, spawn } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import {
    CONNECTION_RETRY_BACKOFF_MS,
    CONNECTION_RETRY_MS,
    DEFAULT_CONNECT_TIMEOUT_MS,
    RUNTIME_ARG_PIPE_PATH,
    RUNTIME_ARG_PROTOCOL_VERSION,
    RUNTIME_AUTH_TOKEN_ENV_VAR,
    MAX_CONNECT_TIMEOUT_MS,
    MIN_CONNECT_TIMEOUT_MS,
    RUNTIME_PROTOCOL_VERSION,
    STDERR_BUFFER_LIMIT,
    MAX_CONNECTION_RETRY_BACKOFF_MS,
} from '../../constants';
import { GaldurSettings, RuntimeHealthResult } from '../../types';
import { tokenizeCommandLine } from '../../utils/cliArgs';
import { commandExistsOnPath } from '../../utils/process';
import { looksLikePath } from '../../utils/strings';
import { Connection } from './Connection';
import {
    RuntimeCommandType,
    RuntimeEvent,
    RuntimeRequestPayloadMap,
    RuntimeResponsePayloadMap,
} from '../../../shared/ipc-types';
import { Manager } from './Manager';

export class HostService {
    private readonly connection = new Connection();
    private readonly pipePath: string;
    private readonly authToken: string;

    private runtimeProcess: ChildProcess | null = null;
    private lastRuntimeStartError: string | null = null;
    private runtimeStderrTail = '';
    private connectPromise: Promise<void> | null = null;
    private disposed = false;

    public constructor(
        private readonly vaultPath: string,
        private readonly runtimeManager: Manager
    ) {
        this.pipePath = this.runtimeManager.buildPipePath();
        this.authToken = this.runtimeManager.createAuthToken();
    }

    public onEvent(listener: (event: RuntimeEvent) => void): () => void {
        return this.connection.onEvent(listener);
    }

    public async healthCheck(settings: GaldurSettings): Promise<RuntimeHealthResult> {
        try {
            await this.ensureConnected(settings);
            await this.connection.request(this.authToken, 'ping', {}, this.getConnectTimeout(settings));
            return { ok: true, message: 'Runtime is healthy.' };
        } catch (error) {
            return { ok: false, message: `Runtime is unavailable: ${String(error)}` };
        }
    }

    public async ensureConnected(settings: GaldurSettings): Promise<void> {
        this.assertNotDisposed();
        if (this.connection.isConnected()) {
            return;
        }

        if (this.connectPromise) {
            await this.connectPromise;
            return;
        }

        this.connectPromise = this.ensureConnectedInternal(settings).finally(() => {
            this.connectPromise = null;
        });
        await this.connectPromise;
    }

    public async request<T extends RuntimeCommandType>(
        settings: GaldurSettings,
        type: T,
        payload: RuntimeRequestPayloadMap[T],
        timeoutMs?: number
    ): Promise<RuntimeResponsePayloadMap[T]> {
        this.assertNotDisposed();
        await this.ensureConnected(settings);
        this.assertNotDisposed();
        return await this.connection.request(
            this.authToken,
            type,
            payload,
            timeoutMs ?? this.getConnectTimeout(settings)
        );
    }

    public async dispose(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const pending = this.connectPromise;
        this.connection.close();
        this.connectPromise = null;
        if (this.runtimeProcess) {
            this.runtimeProcess.kill();
            this.runtimeProcess = null;
        }
        if (pending) {
            await pending.catch(() => {});
        }
    }

    private async ensureConnectedInternal(settings: GaldurSettings): Promise<void> {
        this.assertNotDisposed();
        const timeoutMs = this.getConnectTimeout(settings);
        try {
            await this.connection.connect(this.pipePath, timeoutMs);
            return;
        } catch (error) {
            if (!settings.runtimeAutoStart) {
                throw error;
            }
        }

        this.assertNotDisposed();
        await this.startRuntimeProcess(settings);
        this.assertNotDisposed();
        await this.waitForConnection(timeoutMs);
    }

    private async startRuntimeProcess(settings: GaldurSettings): Promise<void> {
        this.assertNotDisposed();
        const command = this.resolveRuntimeCommand(settings);
        await this.assertCommandAvailable(command.command);

        this.runtimeProcess?.kill();
        this.lastRuntimeStartError = null;
        this.runtimeStderrTail = '';
        this.runtimeProcess = spawn(
            command.command,
            [
                ...command.args,
                RUNTIME_ARG_PIPE_PATH,
                this.pipePath,
                RUNTIME_ARG_PROTOCOL_VERSION,
                String(RUNTIME_PROTOCOL_VERSION),
            ],
            {
                detached: false,
                stdio: ['ignore', 'ignore', 'pipe'],
                windowsHide: true,
                env: { ...process.env, [RUNTIME_AUTH_TOKEN_ENV_VAR]: this.authToken },
            }
        );

        this.runtimeProcess.stderr?.on('data', (chunk: Buffer | string) => {
            const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            this.runtimeStderrTail = `${this.runtimeStderrTail}${data}`.slice(-STDERR_BUFFER_LIMIT);
        });

        this.runtimeProcess.once('error', (error) => {
            const stderr = this.runtimeStderrTail.trim();
            this.lastRuntimeStartError = `Failed to start runtime process: ${String(error)}${
                stderr ? `\nRuntime stderr:\n${stderr}` : ''
            }`;
        });
        this.runtimeProcess.once('exit', (code, signal) => {
            if (!this.connection.isConnected()) {
                const stderr = this.runtimeStderrTail.trim();
                this.lastRuntimeStartError = `Runtime process exited before IPC connection. code=${String(
                    code
                )} signal=${String(signal)}${stderr ? `\nRuntime stderr:\n${stderr}` : ''}`;
            }
            this.runtimeProcess = null;
        });
    }

    private async waitForConnection(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastError: unknown;
        let delay = CONNECTION_RETRY_BACKOFF_MS;
        const maxDelay = MAX_CONNECTION_RETRY_BACKOFF_MS;
        while (Date.now() < deadline) {
            this.assertNotDisposed();
            if (this.lastRuntimeStartError) {
                throw new Error(this.lastRuntimeStartError);
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            try {
                await this.connection.connect(this.pipePath, Math.min(CONNECTION_RETRY_MS, remaining));
                return;
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay = Math.min(delay * 2, maxDelay);
            }
        }
        throw new Error(`Failed to connect to runtime within timeout: ${String(lastError)}`);
    }

    private resolveRuntimeCommand(settings: GaldurSettings): {
        command: string;
        args: string[];
    } {
        const configured = settings.runtimePath.trim();
        if (!configured) {
            return {
                command: this.runtimeManager.getResolvedRuntimePath(this.vaultPath, settings),
                args: [],
            };
        }

        if (looksLikePath(configured)) {
            return {
                command: configured,
                args: [],
            };
        }

        const tokens = tokenizeCommandLine(configured);
        if (tokens.length === 0) {
            throw new Error('Runtime path is configured but empty.');
        }
        return {
            command: tokens[0],
            args: tokens.slice(1),
        };
    }

    private async assertCommandAvailable(commandPath: string): Promise<void> {
        if (!looksLikePath(commandPath)) {
            if (!(await commandExistsOnPath(commandPath))) {
                throw new Error(`Runtime command not found on PATH: ${commandPath}`);
            }
            return;
        }

        try {
            await access(commandPath, constants.X_OK);
        } catch {
            throw new Error(`Runtime executable not accessible: ${commandPath}`);
        }
    }

    private getConnectTimeout(settings: GaldurSettings): number {
        const value = settings.runtimeConnectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        return Math.min(MAX_CONNECT_TIMEOUT_MS, Math.max(MIN_CONNECT_TIMEOUT_MS, value));
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new Error('Runtime host has been disposed.');
        }
    }
}
