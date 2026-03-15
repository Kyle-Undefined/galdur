import { delimiter, posix, win32 } from 'path';
import { TERM_ENV_VALUE } from '../../constants';
import { stripOuterQuotes } from '../../utils/strings';

export function buildSpawnEnv(
    command: string,
    baseEnv: NodeJS.ProcessEnv = process.env,
    wslMode = false
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
        ...baseEnv,
        TERM: TERM_ENV_VALUE,
    };

    if (wslMode) {
        return env;
    }

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
    // Check for Windows-style paths first (drive letter or UNC)
    if (/^[a-zA-Z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\')) {
        return win32.dirname(normalized);
    }
    // Then check POSIX-style paths
    if (posix.isAbsolute(normalized)) {
        return posix.dirname(normalized);
    }
    return null;
}

function getPathEnvKey(env: NodeJS.ProcessEnv): string {
    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
    if (existingKey) {
        return existingKey;
    }
    return process.platform === 'win32' ? 'Path' : 'PATH';
}

function pathContainsEntry(pathValue: string, entry: string): boolean {
    const isWindowsPath = win32.isAbsolute(entry) && !posix.isAbsolute(entry);
    const pathDelimiter = isWindowsPath ? ';' : delimiter;
    const target = isWindowsPath ? entry.toLowerCase() : entry;
    return pathValue
        .split(pathDelimiter)
        .map((part) => normalizePathEntry(part, isWindowsPath))
        .some((part) => part === target);
}

function normalizePathEntry(value: string, windowsStyle: boolean): string {
    const normalized = value.trim().replace(/^"(.*)"$/, '$1');
    return windowsStyle ? normalized.toLowerCase() : normalized;
}
