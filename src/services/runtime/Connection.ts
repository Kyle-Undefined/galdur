import { randomUUID } from 'crypto';
import { Socket, connect } from 'net';
import { IPC_MAX_LINE_LENGTH } from '../../constants';
import { isRecord } from '../../utils/typeGuards';
import {
    RuntimeCommandType,
    RuntimeEvent,
    RuntimeRequestPayloadMap,
    RuntimeResponse,
    RuntimeResponsePayloadMap,
} from '../../../shared/ipc-types';
import { createRequest } from './createRequest';

type PendingRequest = {
    commandType: RuntimeCommandType;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
};

export class Connection {
    private socket: Socket | null = null;
    private buffer = '';
    private pending = new Map<string, PendingRequest>();
    private listeners = new Set<(event: RuntimeEvent) => void>();
    private closed = false;

    public async connect(pipePath: string, timeoutMs: number): Promise<void> {
        this.close();
        this.closed = false;

        await new Promise<void>((resolve, reject) => {
            const socket = connect(pipePath);
            let settled = false;

            const complete = (handler: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                handler();
            };

            const timeout = setTimeout(() => {
                complete(() => {
                    socket.destroy();
                    reject(new Error(`Timed out connecting to runtime pipe: ${pipePath}`));
                });
            }, timeoutMs);

            socket.once('connect', () => {
                complete(() => {
                    this.socket = socket;
                    this.bindSocket(socket);
                    resolve();
                });
            });

            socket.once('error', (error) => {
                complete(() => {
                    socket.destroy();
                    reject(error);
                });
            });
        });
    }

    public isConnected(): boolean {
        return Boolean(this.socket && !this.socket.destroyed && !this.closed);
    }

    public onEvent(listener: (event: RuntimeEvent) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    public async request<T extends RuntimeCommandType>(
        authToken: string,
        type: T,
        payload: RuntimeRequestPayloadMap[T],
        timeoutMs: number
    ): Promise<RuntimeResponsePayloadMap[T]> {
        if (!this.socket || this.socket.destroyed || this.closed) {
            throw new Error('Runtime connection is not active');
        }

        const id = randomUUID();
        const request = createRequest(id, authToken, type, payload);
        const serialized = `${JSON.stringify(request)}\n`;

        return await new Promise<RuntimeResponsePayloadMap[T]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Runtime request timed out: ${type}`));
            }, timeoutMs);

            this.pending.set(id, {
                commandType: type,
                resolve: resolve as (value: unknown) => void,
                reject,
                timeout,
            });
            this.socket?.write(serialized, 'utf8', (err) => {
                if (err) {
                    const pending = this.pending.get(id);
                    if (pending) {
                        this.pending.delete(id);
                        clearTimeout(pending.timeout);
                        pending.reject(err);
                    }
                }
            });
        });
    }

    public close(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.buffer = '';
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Runtime connection closed'));
        }
        this.pending.clear();

        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        this.socket = null;
    }

    private bindSocket(socket: Socket): void {
        socket.on('data', (chunk: Buffer | string) => {
            if (this.socket !== socket || this.closed) {
                return;
            }
            const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            this.buffer += data;

            if (this.buffer.length > IPC_MAX_LINE_LENGTH) {
                this.buffer = '';
                this.closeCurrentSocket(socket);
                return;
            }

            this.consumeLines();
        });

        socket.on('close', () => {
            this.closeCurrentSocket(socket);
        });

        socket.on('error', (error) => {
            if (this.socket !== socket || this.closed) {
                return;
            }
            console.error('Runtime socket error:', error);
            this.closeCurrentSocket(socket);
        });
    }

    private consumeLines(): void {
        while (true) {
            const idx = this.buffer.indexOf('\n');
            if (idx < 0) {
                break;
            }

            const rawLine = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx + 1);

            if (rawLine.length > IPC_MAX_LINE_LENGTH) {
                this.buffer = '';
                this.close();
                return;
            }

            const line = rawLine.trim();
            if (!line) {
                continue;
            }

            this.handleMessageLine(line);
        }
    }

    private closeCurrentSocket(socket: Socket): void {
        if (this.socket !== socket) {
            return;
        }
        this.close();
    }

    private handleMessageLine(line: string): void {
        let raw: unknown;
        try {
            raw = JSON.parse(line);
        } catch {
            console.warn('[galdur] Failed to parse IPC message:', line.slice(0, 200));
            return;
        }

        if (!isRecord(raw) || typeof raw.kind !== 'string') {
            return;
        }

        switch (raw.kind) {
            case 'response': {
                if (!this.isRuntimeResponse(raw.response)) {
                    return;
                }
                const response = raw.response;
                const pending = this.pending.get(response.id);
                if (!pending) {
                    return;
                }

                this.pending.delete(response.id);
                clearTimeout(pending.timeout);
                if (response.ok) {
                    if (!isResponsePayloadForType(pending.commandType, response.payload)) {
                        pending.reject(
                            new Error(`Invalid runtime response payload for command: ${pending.commandType}`)
                        );
                        return;
                    }
                    pending.resolve(response.payload);
                } else {
                    pending.reject(new Error(response.error ?? 'Runtime request failed'));
                }
                return;
            }
            case 'event': {
                if (!this.isRuntimeEvent(raw.event)) {
                    return;
                }
                const event = raw.event;
                for (const listener of this.listeners) {
                    try {
                        listener(event);
                    } catch {
                        // Listener error should not affect other listeners
                    }
                }
                return;
            }
        }
    }

    private isRuntimeResponse(value: unknown): value is RuntimeResponse {
        if (!isRecord(value)) {
            return false;
        }
        if (typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
            return false;
        }
        if (!value.ok && value.error !== undefined && typeof value.error !== 'string') {
            return false;
        }
        return true;
    }

    private isRuntimeEvent(value: unknown): value is RuntimeEvent {
        if (!isRecord(value) || typeof value.event !== 'string') {
            return false;
        }
        switch (value.event) {
            case 'ready':
                return isReadyPayload(value.payload);
            case 'data':
                return isDataPayload(value.payload);
            case 'exit':
                return isExitPayload(value.payload);
            case 'error':
                return isErrorPayload(value.payload);
            default:
                return false;
        }
    }
}

function isReadyPayload(value: unknown): value is { version: string } {
    return isRecord(value) && typeof value.version === 'string';
}

function isDataPayload(value: unknown): value is { sessionId: string; data: string } {
    return isRecord(value) && typeof value.sessionId === 'string' && typeof value.data === 'string';
}

function isExitPayload(value: unknown): value is {
    sessionId: string;
    event: { exitCode: number; signal?: number };
} {
    return (
        isRecord(value) &&
        typeof value.sessionId === 'string' &&
        isRecord(value.event) &&
        typeof value.event.exitCode === 'number' &&
        Number.isFinite(value.event.exitCode) &&
        (value.event.signal === undefined ||
            (typeof value.event.signal === 'number' && Number.isFinite(value.event.signal)))
    );
}

function isErrorPayload(value: unknown): value is { sessionId?: string; message: string } {
    return (
        isRecord(value) &&
        typeof value.message === 'string' &&
        (value.sessionId === undefined || typeof value.sessionId === 'string')
    );
}

function isResponsePayloadForType<T extends RuntimeCommandType>(
    type: T,
    value: unknown
): value is RuntimeResponsePayloadMap[T] {
    switch (type) {
        case 'ping':
            return isRecord(value) && typeof value.version === 'string';
        case 'spawn':
            return (
                isRecord(value) &&
                typeof value.sessionId === 'string' &&
                typeof value.pid === 'number' &&
                Number.isFinite(value.pid)
            );
        case 'write':
        case 'resize':
        case 'kill':
            return isRecord(value) && Object.keys(value).length === 0;
        default:
            return false;
    }
}
