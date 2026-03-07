import * as net from 'net';
import { parseArgs } from './args';
import { getPtyModule } from './ptyLoader';
import { SessionManager } from './sessionManager';
import {
    RuntimeEvent,
    RuntimeKillPayload,
    RuntimeRequest,
    RuntimeResizePayload,
    RuntimeResponse,
    RuntimeSocketMessage,
    RuntimeSpawnPayload,
    RuntimeWritePayload,
} from '../../shared/ipc-types';
import { resolveRuntimeVersion } from './version';
import { IPC_MAX_LINE_LENGTH, RUNTIME_ARG_PIPE_PATH, RUNTIME_AUTH_TOKEN_ENV_VAR } from 'src/constants';

const args = parseArgs(process.argv.slice(2));
const runtimeVersion = resolveRuntimeVersion();

if (args.version) {
    process.stdout.write(`${runtimeVersion}\n`);
    process.exit(0);
}

if (args.healthcheck) {
    process.stdout.write('ok\n');
    process.exit(0);
}

if (!args.pipePath || !args.authToken) {
    process.stderr.write(
        `Missing required args. Expected ${RUNTIME_ARG_PIPE_PATH} <\\\\.\\pipe\\...> and ${RUNTIME_AUTH_TOKEN_ENV_VAR} env var\n`
    );
    process.exit(1);
}

const sockets = new Set<net.Socket>();
const authenticatedSockets = new Set<net.Socket>();
const protocolVersion = args.protocolVersion;
const sessions = new SessionManager(
    (event) => {
        broadcastEvent(event);
    },
    () => getPtyModule()
);

const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    writeEvent(socket, {
        event: 'ready',
        payload: {
            version: runtimeVersion,
        },
    });

    let buffer = '';
    socket.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

        if (buffer.length > IPC_MAX_LINE_LENGTH) {
            buffer = '';
            socket.destroy();
            return;
        }

        while (true) {
            const idx = buffer.indexOf('\n');
            if (idx < 0) {
                break;
            }
            const rawLine = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (rawLine.length > IPC_MAX_LINE_LENGTH) {
                buffer = '';
                socket.destroy();
                return;
            }
            const line = rawLine.trim();
            if (!line) {
                continue;
            }
            handleLine(socket, line);
        }
    });

    socket.on('close', () => {
        sockets.delete(socket);
        authenticatedSockets.delete(socket);
    });
    socket.on('error', () => {
        sockets.delete(socket);
        authenticatedSockets.delete(socket);
    });
});
server.listen(args.pipePath);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown(): void {
    sessions.disposeAll();
    for (const socket of sockets) {
        socket.destroy();
    }
    sockets.clear();
    authenticatedSockets.clear();
    server.close(() => process.exit(0));
}

function handleLine(socket: net.Socket, line: string): void {
    let requestUnknown: unknown;
    try {
        requestUnknown = JSON.parse(line);
    } catch {
        writeResponse(socket, {
            id: 'unknown',
            type: 'ping',
            ok: false,
            error: 'Invalid JSON request.',
        });
        return;
    }

    if (!isRuntimeRequest(requestUnknown)) {
        writeResponse(socket, {
            id: 'unknown',
            type: 'ping',
            ok: false,
            error: 'Invalid request payload.',
        });
        return;
    }

    const request = requestUnknown;
    if (request.authToken !== args.authToken) {
        writeResponse(socket, {
            id: request.id,
            type: request.type,
            ok: false,
            error: 'Invalid auth token.',
        });
        return;
    }

    if (request.protocolVersion !== protocolVersion) {
        writeResponse(socket, {
            id: request.id,
            type: request.type,
            ok: false,
            error: `Protocol mismatch. expected=${protocolVersion} actual=${String(request.protocolVersion)}`,
        });
        return;
    }

    authenticatedSockets.add(socket);

    try {
        switch (request.type) {
            case 'ping':
                writeResponse(socket, {
                    id: request.id,
                    type: 'ping',
                    ok: true,
                    payload: { version: runtimeVersion },
                });
                return;
            case 'spawn':
                handleSpawn(socket, request.id, request.payload);
                return;
            case 'write':
                handleWrite(socket, request.id, request.payload);
                return;
            case 'resize':
                handleResize(socket, request.id, request.payload);
                return;
            case 'kill':
                handleKill(socket, request.id, request.payload);
                return;
            default:
                writeResponse(socket, {
                    id: request.id,
                    type: request.type,
                    ok: false,
                    error: `Unsupported command: ${request.type}`,
                });
        }
    } catch (error) {
        writeResponse(socket, {
            id: request.id,
            type: request.type,
            ok: false,
            error: String(error),
        });
    }
}

function handleSpawn(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseSpawnPayload(payloadUnknown);
    if (!payload) {
        writeResponse(socket, {
            id,
            type: 'spawn',
            ok: false,
            error: 'Invalid spawn payload.',
        });
        return;
    }

    try {
        const result = sessions.spawn(payload);
        writeResponse(socket, {
            id,
            type: 'spawn',
            ok: true,
            payload: result,
        });
    } catch (error) {
        writeResponse(socket, {
            id,
            type: 'spawn',
            ok: false,
            error: String(error),
        });
    }
}

function handleWrite(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseWritePayload(payloadUnknown);
    if (!payload) {
        writeResponse(socket, {
            id,
            type: 'write',
            ok: false,
            error: 'Invalid write payload.',
        });
        return;
    }
    try {
        sessions.write(payload);
    } catch (error) {
        writeResponse(socket, {
            id,
            type: 'write',
            ok: false,
            error: String(error),
        });
        return;
    }
    writeResponse(socket, { id, type: 'write', ok: true, payload: {} });
}

function handleResize(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseResizePayload(payloadUnknown);
    if (!payload) {
        writeResponse(socket, {
            id,
            type: 'resize',
            ok: false,
            error: 'Invalid resize payload.',
        });
        return;
    }
    try {
        sessions.resize(payload);
    } catch (error) {
        writeResponse(socket, {
            id,
            type: 'resize',
            ok: false,
            error: String(error),
        });
        return;
    }
    writeResponse(socket, { id, type: 'resize', ok: true, payload: {} });
}

function handleKill(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseKillPayload(payloadUnknown);
    if (!payload) {
        writeResponse(socket, {
            id,
            type: 'kill',
            ok: false,
            error: 'Invalid kill payload.',
        });
        return;
    }
    try {
        sessions.kill(payload);
    } catch (error) {
        writeResponse(socket, {
            id,
            type: 'kill',
            ok: false,
            error: String(error),
        });
        return;
    }
    writeResponse(socket, { id, type: 'kill', ok: true, payload: {} });
}

function broadcastEvent(event: RuntimeEvent): void {
    const message: RuntimeSocketMessage = { kind: 'event', event };
    for (const socket of authenticatedSockets) {
        writeSocketMessage(socket, message);
    }
}

function writeResponse(socket: net.Socket, response: RuntimeResponse): void {
    writeSocketMessage(socket, { kind: 'response', response });
}

function writeEvent(socket: net.Socket, event: RuntimeEvent): void {
    writeSocketMessage(socket, { kind: 'event', event });
}

function writeSocketMessage(socket: net.Socket, value: RuntimeSocketMessage): void {
    if (!socket || socket.destroyed) {
        return;
    }
    try {
        socket.write(`${JSON.stringify(value)}\n`);
    } catch {
        // Ignore transient socket errors.
    }
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
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

function parseSpawnPayload(value: unknown): RuntimeSpawnPayload | null {
    if (!isRecord(value)) {
        return null;
    }
    if (
        typeof value.command !== 'string' ||
        !isStringArray(value.args) ||
        typeof value.cwd !== 'string' ||
        typeof value.cols !== 'number' ||
        !Number.isFinite(value.cols) ||
        typeof value.rows !== 'number' ||
        !Number.isFinite(value.rows) ||
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

function parseWritePayload(value: unknown): RuntimeWritePayload | null {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.sessionId !== 'string' || typeof value.data !== 'string') {
        return null;
    }
    return {
        sessionId: value.sessionId,
        data: value.data,
    };
}

function parseResizePayload(value: unknown): RuntimeResizePayload | null {
    if (!isRecord(value)) {
        return null;
    }
    if (
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

function parseKillPayload(value: unknown): RuntimeKillPayload | null {
    if (!isRecord(value) || typeof value.sessionId !== 'string') {
        return null;
    }
    return { sessionId: value.sessionId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isProcessEnv(value: unknown): value is Record<string, string | undefined> {
    if (!isRecord(value)) {
        return false;
    }
    return Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}
