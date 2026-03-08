import {
    GaldurSettings,
    RuntimeBackend as RuntimeBackendContract,
    RuntimeHealthResult,
    TerminalSessionStartOptions,
    TerminalSessionStartResult,
} from '../../types';
import { SESSION_EARLY_EVENT_BUFFER_LIMIT, STARTUP_TIMEOUT_MS } from '../../constants';
import { HostService } from './HostService';
import { RuntimeEvent } from '../../../shared/ipc-types';

type BackendOptions = {
    host: HostService;
    settings: GaldurSettings;
};

export class Backend implements RuntimeBackendContract {
    public readonly id = 'managed';

    private readonly host: HostService;
    private readonly settings: GaldurSettings;
    private sessionId: string | null = null;
    private startupCheckTimer: ReturnType<typeof setTimeout> | null = null;
    private offEvent: (() => void) | null = null;

    public constructor(options: BackendOptions) {
        this.host = options.host;
        this.settings = options.settings;
    }

    public async healthCheck(): Promise<RuntimeHealthResult> {
        return await this.host.healthCheck(this.settings);
    }

    public async start(options: TerminalSessionStartOptions): Promise<TerminalSessionStartResult> {
        await this.stop();

        let stopped = false;

        try {
            await this.host.ensureConnected(this.settings);
            const timeoutMs = options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS;
            let sawOutput = false;
            let activeSessionId: string | null = null;
            let droppedEventCount = 0;
            const pendingSessionEvents: RuntimeEvent[] = [];

            const dispatchSessionEvent = (event: RuntimeEvent): void => {
                if (!activeSessionId) {
                    if (event.event === 'data' || event.event === 'exit') {
                        pendingSessionEvents.push(event);
                        if (pendingSessionEvents.length > SESSION_EARLY_EVENT_BUFFER_LIMIT) {
                            pendingSessionEvents.shift();
                            droppedEventCount++;
                        }
                    }
                    return;
                }
                this.handleRuntimeEvent(event, activeSessionId, {
                    onData: (data) => {
                        sawOutput = true;
                        options.onData(data);
                    },
                    onExit: (eventPayload) => {
                        this.clearStartupTimer();
                        this.sessionId = null;
                        activeSessionId = null;
                        this.offEvent?.();
                        this.offEvent = null;
                        options.onExit(eventPayload);
                    },
                });
            };

            const offHostEvent = this.host.onEvent((event) => {
                dispatchSessionEvent(event);
            });
            this.offEvent = () => {
                stopped = true;
                offHostEvent();
            };

            const response = await this.host.request(
                this.settings,
                'spawn',
                {
                    command: options.command,
                    args: options.args,
                    cwd: options.cwd,
                    cols: options.cols,
                    rows: options.rows,
                    env: options.env,
                },
                timeoutMs
            );

            if (stopped) {
                // stop() was called while awaiting spawn — kill the orphaned session.
                try {
                    await this.host.request(this.settings, 'kill', {
                        sessionId: response.sessionId,
                    });
                } catch {
                    // Ignore cleanup errors.
                }
                return { ok: false, error: new Error('Session stopped during startup') };
            }

            this.sessionId = response.sessionId;
            activeSessionId = response.sessionId;
            if (droppedEventCount > 0) {
                console.warn(`[galdur] Dropped ${droppedEventCount} early session events (buffer overflow)`);
                options.onData(`\r\n[galdur] Warning: ${droppedEventCount} early output events were dropped\r\n`);
            }
            const buffered = pendingSessionEvents.slice();
            pendingSessionEvents.length = 0;
            for (const event of buffered) {
                dispatchSessionEvent(event);
                if (!activeSessionId) break;
            }

            if (!activeSessionId) {
                return { ok: false, error: new Error('Session exited during startup') };
            }

            this.clearStartupTimer();
            this.startupCheckTimer = setTimeout(() => {
                if (this.sessionId && !sawOutput) {
                    options.onNoOutput();
                }
            }, timeoutMs);

            return { ok: true, pid: response.pid };
        } catch (error) {
            await this.stop();
            return {
                ok: false,
                error: error instanceof Error ? error : new Error(String(error)),
            };
        }
    }

    public async write(data: string): Promise<void> {
        if (!this.sessionId) {
            return;
        }
        await this.host.request(this.settings, 'write', {
            sessionId: this.sessionId,
            data,
        });
    }

    public async resize(cols: number, rows: number): Promise<void> {
        if (!this.sessionId) {
            return;
        }
        await this.host.request(this.settings, 'resize', {
            sessionId: this.sessionId,
            cols,
            rows,
        });
    }

    public async stop(): Promise<void> {
        this.clearStartupTimer();

        if (this.sessionId) {
            try {
                await this.host.request(this.settings, 'kill', {
                    sessionId: this.sessionId,
                });
            } catch {
                // Ignore shutdown errors.
            }
            this.sessionId = null;
        }

        this.offEvent?.();
        this.offEvent = null;
    }

    private clearStartupTimer(): void {
        if (this.startupCheckTimer) {
            clearTimeout(this.startupCheckTimer);
            this.startupCheckTimer = null;
        }
    }

    private handleRuntimeEvent(
        event: RuntimeEvent,
        activeSessionId: string,
        handlers: {
            onData: (data: string) => void;
            onExit: (event: { exitCode: number; signal?: number }) => void;
        }
    ): void {
        if (event.event === 'data' && event.payload.sessionId === activeSessionId) {
            handlers.onData(event.payload.data);
            return;
        }

        if (event.event === 'exit' && event.payload.sessionId === activeSessionId) {
            handlers.onExit(event.payload.event);
            return;
        }
    }
}
