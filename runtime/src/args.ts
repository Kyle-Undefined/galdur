import arg from 'arg';
import {
    RUNTIME_ARG_HEALTHCHECK,
    RUNTIME_ARG_PIPE_PATH,
    RUNTIME_ARG_PROTOCOL_VERSION,
    RUNTIME_ARG_VERSION,
    RUNTIME_AUTH_TOKEN_ENV_VAR,
    RUNTIME_PROTOCOL_VERSION,
} from 'src/constants';
import { ParsedRuntimeArgs } from './types';

export function parseArgs(argv: string[]): ParsedRuntimeArgs {
    const parsed = arg(
        {
            [RUNTIME_ARG_PIPE_PATH]: String,
            [RUNTIME_ARG_PROTOCOL_VERSION]: Number,
            [RUNTIME_ARG_VERSION]: Boolean,
            [RUNTIME_ARG_HEALTHCHECK]: Boolean,
        },
        { argv }
    );

    return {
        pipePath: parsed[RUNTIME_ARG_PIPE_PATH] ?? '',
        authToken: process.env[RUNTIME_AUTH_TOKEN_ENV_VAR] || '',
        protocolVersion: parsed[RUNTIME_ARG_PROTOCOL_VERSION] ?? RUNTIME_PROTOCOL_VERSION,
        version: parsed[RUNTIME_ARG_VERSION] ?? false,
        healthcheck: parsed[RUNTIME_ARG_HEALTHCHECK] ?? false,
    };
}
