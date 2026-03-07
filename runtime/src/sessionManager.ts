import { randomUUID } from 'crypto';
import {
    RuntimeDataEvent,
    RuntimeExitEvent,
    RuntimeKillPayload,
    RuntimeResizePayload,
    RuntimeSpawnPayload,
    RuntimeWritePayload,
} from '../../shared/ipc-types';
import { MIN_TERMINAL_COLS, MIN_TERMINAL_ROWS, TERM_ENV_VALUE } from 'src/constants';
import { PtyModule } from './types';

type SessionRecord = {
    proc: ReturnType<PtyModule['spawn']>;
    disposeData: { dispose(): void };
    disposeExit: { dispose(): void };
};

export class SessionManager {
    private readonly sessions = new Map<string, SessionRecord>();

    public constructor(
        private readonly broadcast: (event: RuntimeDataEvent | RuntimeExitEvent) => void,
        private readonly getPtyModule: () => PtyModule
    ) {}

    public spawn(payload: RuntimeSpawnPayload): {
        sessionId: string;
        pid: number;
    } {
        const pty = this.getPtyModule();
        const sessionId = randomUUID();
        const proc = pty.spawn(payload.command, payload.args, {
            name: TERM_ENV_VALUE,
            useConpty: false,
            cwd: payload.cwd,
            cols: toInt(payload.cols, MIN_TERMINAL_COLS),
            rows: toInt(payload.rows, MIN_TERMINAL_ROWS),
            env: payload.env,
        });

        const session: SessionRecord = {
            proc,
            disposeData: proc.onData((data) => {
                this.broadcast({
                    event: 'data',
                    payload: { sessionId, data },
                });
            }),
            disposeExit: proc.onExit((event) => {
                this.broadcast({
                    event: 'exit',
                    payload: {
                        sessionId,
                        event: {
                            exitCode: event.exitCode,
                            signal: event.signal,
                        },
                    },
                });
                this.disposeSession(sessionId);
            }),
        };

        this.sessions.set(sessionId, session);
        return { sessionId, pid: proc.pid };
    }

    public write(payload: RuntimeWritePayload): void {
        const session = this.sessions.get(payload.sessionId);
        if (!session) {
            throw new Error(`Session not found: ${payload.sessionId}`);
        }
        session.proc.write(payload.data);
    }

    public resize(payload: RuntimeResizePayload): void {
        const session = this.sessions.get(payload.sessionId);
        if (!session) {
            throw new Error(`Session not found: ${payload.sessionId}`);
        }
        try {
            session.proc.resize(toInt(payload.cols, MIN_TERMINAL_COLS), toInt(payload.rows, MIN_TERMINAL_ROWS));
        } catch {
            // Ignore resize races around terminal teardown.
        }
    }

    public kill(payload: RuntimeKillPayload): void {
        const sessionId = payload.sessionId;
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        try {
            session.proc.kill();
        } catch {
            // Ignore kill races around process exit.
        }
        this.disposeSession(sessionId);
    }

    public disposeAll(): void {
        const sessionIds = [...this.sessions.keys()];
        for (const sessionId of sessionIds) {
            const session = this.sessions.get(sessionId);
            if (session) {
                try {
                    session.proc.kill();
                } catch {
                    // Ignore shutdown races.
                }
            }
            this.disposeSession(sessionId);
        }
    }

    private disposeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        try {
            session.disposeData.dispose();
        } catch {
            // Ignore cleanup errors.
        }
        try {
            session.disposeExit.dispose();
        } catch {
            // Ignore cleanup errors.
        }
        this.sessions.delete(sessionId);
    }
}

function toInt(value: number, fallback: number, min = 1): number {
    const parsed = Math.trunc(value);
    if (!Number.isFinite(parsed) || parsed < min) {
        return fallback;
    }
    return parsed;
}
