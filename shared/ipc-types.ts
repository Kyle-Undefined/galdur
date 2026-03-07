export type TerminalExitEvent = { exitCode: number; signal?: number };

export type RuntimeCommandType = 'ping' | 'spawn' | 'write' | 'resize' | 'kill';

export type RuntimeSpawnPayload = {
    command: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string | undefined>;
};

export type RuntimeWritePayload = {
    sessionId: string;
    data: string;
};

export type RuntimeResizePayload = {
    sessionId: string;
    cols: number;
    rows: number;
};

export type RuntimeKillPayload = {
    sessionId: string;
};

export type RuntimeRequestPayloadMap = {
    ping: Record<string, never>;
    spawn: RuntimeSpawnPayload;
    write: RuntimeWritePayload;
    resize: RuntimeResizePayload;
    kill: RuntimeKillPayload;
};

export type RuntimeResponsePayloadMap = {
    ping: { version: string };
    spawn: { sessionId: string; pid: number };
    write: Record<string, never>;
    resize: Record<string, never>;
    kill: Record<string, never>;
};

export type RuntimeRequest<T extends RuntimeCommandType = RuntimeCommandType> = {
    id: string;
    type: T;
    payload: RuntimeRequestPayloadMap[T];
    authToken: string;
    protocolVersion: number;
};

export type RuntimeResponse<T extends RuntimeCommandType = RuntimeCommandType> =
    | {
          id: string;
          type: T;
          ok: true;
          payload: RuntimeResponsePayloadMap[T];
      }
    | {
          id: string;
          type: T;
          ok: false;
          error: string;
      };

export type RuntimeEventDataPayload = {
    sessionId: string;
    data: string;
};

export type RuntimeEventExitPayload = {
    sessionId: string;
    event: TerminalExitEvent;
};

export type RuntimeEventErrorPayload = {
    sessionId?: string;
    message: string;
};

export type RuntimeReadyEvent = {
    event: 'ready';
    payload: { version: string };
};
export type RuntimeDataEvent = {
    event: 'data';
    payload: RuntimeEventDataPayload;
};
export type RuntimeExitEvent = {
    event: 'exit';
    payload: RuntimeEventExitPayload;
};
export type RuntimeErrorEvent = {
    event: 'error';
    payload: RuntimeEventErrorPayload;
};

export type RuntimeEvent = RuntimeReadyEvent | RuntimeDataEvent | RuntimeExitEvent | RuntimeErrorEvent;

export type RuntimeSocketMessage =
    | { kind: 'response'; response: RuntimeResponse }
    | { kind: 'event'; event: RuntimeEvent };
