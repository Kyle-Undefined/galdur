import * as net from 'net';
import { parseArgs } from './args';
import { getPtyModule } from './ptyLoader';
import { SessionManager } from './sessionManager';
import {
    createEmptyPayloadResponse,
    isRuntimeRequest,
    parseRuntimeKillPayload,
    parseRuntimeResizePayload,
    parseRuntimeSpawnPayload,
    parseRuntimeWritePayload,
} from '../../shared/ipc-codecs';
import { RuntimeEvent, RuntimeResponse, RuntimeSocketMessage } from '../../shared/ipc-types';
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
    const payload = parseRuntimeSpawnPayload(payloadUnknown);
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
    const payload = parseRuntimeWritePayload(payloadUnknown);
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
    writeResponse(socket, { id, type: 'write', ok: true, payload: createEmptyPayloadResponse('write') });
}

function handleResize(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseRuntimeResizePayload(payloadUnknown);
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
    writeResponse(socket, { id, type: 'resize', ok: true, payload: createEmptyPayloadResponse('resize') });
}

function handleKill(socket: net.Socket, id: string, payloadUnknown: unknown): void {
    const payload = parseRuntimeKillPayload(payloadUnknown);
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
    writeResponse(socket, { id, type: 'kill', ok: true, payload: createEmptyPayloadResponse('kill') });
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
