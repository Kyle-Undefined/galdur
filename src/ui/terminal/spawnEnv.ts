import { delimiter, dirname, isAbsolute } from 'path';
import { TERM_ENV_VALUE } from '../../constants';
import { stripOuterQuotes } from '../../utils/strings';

export function buildSpawnEnv(command: string, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...baseEnv,
        TERM: TERM_ENV_VALUE,
    };

    const commandDir = getExecutableDir(command);
    if (!commandDir) {
        return env;
    }

    const pathKey = getPathEnvKey(env);
    const currentPath = env[pathKey] ?? '';
    if (pathContainsEntry(currentPath, commandDir)) {
        return env;
    }

    env[pathKey] = currentPath ? `${commandDir}${delimiter}${currentPath}` : commandDir;
    return env;
}

function getExecutableDir(command: string): string | null {
    const normalized = stripOuterQuotes(command.trim());
    if (!normalized) {
        return null;
    }
    if (!isAbsolute(normalized)) {
        return null;
    }

    return dirname(normalized);
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
    if (existingKey) {
        return existingKey;
    }
    return process.platform === 'win32' ? 'Path' : 'PATH';
}

function pathContainsEntry(pathValue: string, entry: string): boolean {
    if (process.platform !== 'win32') {
        throw new Error(`pathContainsEntry is only supported on Windows (current platform: ${process.platform})`);
    }
    const target = entry.toLowerCase();
    return pathValue
        .split(delimiter)
        .map((part) =>
            part
                .trim()
                .replace(/^"(.*)"$/, '$1')
                .toLowerCase()
        )
        .some((part) => part === target);
}
