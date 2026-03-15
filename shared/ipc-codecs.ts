import {
    EmptyResponseCommandType,
    RuntimeCommandType,
    RuntimeEvent,
    RuntimeKillPayload,
    RuntimeReadyEvent,
    RuntimeRequest,
    RuntimeResizePayload,
    RuntimeResponse,
    RuntimeResponsePayloadMap,
    RuntimeSocketMessage,
    RuntimeSpawnPayload,
    RuntimeWritePayload,
} from './ipc-types';

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.id === 'string' &&
        typeof value.type === 'string' &&
        typeof value.authToken === 'string' &&
        typeof value.protocolVersion === 'number' &&
        Number.isFinite(value.protocolVersion)
    );
}

export function isRuntimeResponse(value: unknown): value is RuntimeResponse {
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

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
    if (!isRecord(value) || typeof value.event !== 'string') {
        return false;
    }
    switch (value.event) {
        case 'ready':
            return isReadyEvent(value);
        case 'data':
            return (
                isRecord(value.payload) &&
                typeof value.payload.sessionId === 'string' &&
                typeof value.payload.data === 'string'
            );
        case 'exit':
            return (
                isRecord(value.payload) &&
                typeof value.payload.sessionId === 'string' &&
                isRecord(value.payload.event) &&
                typeof value.payload.event.exitCode === 'number' &&
                Number.isFinite(value.payload.event.exitCode) &&
                (value.payload.event.signal === undefined ||
                    (typeof value.payload.event.signal === 'number' && Number.isFinite(value.payload.event.signal)))
            );
        case 'error':
            return (
                isRecord(value.payload) &&
                typeof value.payload.message === 'string' &&
                (value.payload.sessionId === undefined || typeof value.payload.sessionId === 'string')
            );
        default:
            return false;
    }
}

export function isRuntimeSocketMessage(value: unknown): value is RuntimeSocketMessage {
    if (!isRecord(value) || typeof value.kind !== 'string') {
        return false;
    }
    switch (value.kind) {
        case 'response':
            return isRuntimeResponse(value.response);
        case 'event':
            return isRuntimeEvent(value.event);
        default:
            return false;
    }
}

export function parseRuntimeSpawnPayload(value: unknown): RuntimeSpawnPayload | null {
    if (!isRecord(value)) {
        return null;
    }
    if (
        typeof value.command !== 'string' ||
        !isStringArray(value.args) ||
        typeof value.cwd !== 'string' ||
        typeof value.cols !== 'number' ||
        !Number.isFinite(value.cols) ||
        !Number.isInteger(value.cols) ||
        value.cols < 1 ||
        typeof value.rows !== 'number' ||
        !Number.isFinite(value.rows) ||
        !Number.isInteger(value.rows) ||
        value.rows < 1 ||
        !isProcessEnv(value.env)
    ) {
        return null;
    }
    return {
        command: value.command,
        args: value.args,
        cwd: value.cwd,
        cols: value.cols,
        rows: value.rows,
        env: value.env,
    };
}

export function parseRuntimeWritePayload(value: unknown): RuntimeWritePayload | null {
    if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.data !== 'string') {
        return null;
    }
    return {
        sessionId: value.sessionId,
        data: value.data,
    };
}

export function parseRuntimeResizePayload(value: unknown): RuntimeResizePayload | null {
    if (
        !isRecord(value) ||
        typeof value.sessionId !== 'string' ||
        typeof value.cols !== 'number' ||
        !Number.isFinite(value.cols) ||
        typeof value.rows !== 'number' ||
        !Number.isFinite(value.rows)
    ) {
        return null;
    }
    return {
        sessionId: value.sessionId,
        cols: value.cols,
        rows: value.rows,
    };
}

export function parseRuntimeKillPayload(value: unknown): RuntimeKillPayload | null {
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
        return null;
    }
    return { sessionId: value.sessionId };
}

export function isResponsePayloadForType<T extends RuntimeCommandType>(
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
            return isEmptyObject(value);
        default:
            return false;
    }
}

export function createEmptyPayloadResponse<T extends EmptyResponseCommandType>(_type: T): RuntimeResponsePayloadMap[T] {
    return {} as RuntimeResponsePayloadMap[T];
}

function isReadyEvent(value: unknown): value is RuntimeReadyEvent {
    return isRecord(value) && isRecord(value.payload) && typeof value.payload.version === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isProcessEnv(value: unknown): value is Record<string, string | undefined> {
    return isRecord(value) && Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}

function isEmptyObject(value: unknown): value is Record<string, never> {
    return isRecord(value) && Object.keys(value).length === 0;
}
