import { join, sep } from 'path';
import { VaultPaths } from '../types';

export function getToolLogPath(vaultPaths: VaultPaths, fileName: string): string {
    const logsDir = join(vaultPaths.pluginDir, 'logs');
    const resolvedPath = join(logsDir, fileName);

    if (!resolvedPath.startsWith(logsDir + sep)) {
        throw new Error('Invalid fileName: path traversal detected');
    }
    return resolvedPath;
}
