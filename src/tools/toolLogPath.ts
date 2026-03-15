import { win32 } from 'path';
import { VaultPaths } from '../types';

export function getToolLogPath(vaultPaths: VaultPaths, fileName: string): string {
    // Vault/plugin paths are Windows-hosted even when the CLI itself is launched through WSL.
    const logsDir = win32.join(vaultPaths.pluginDir, 'logs');
    const resolvedPath = win32.join(logsDir, fileName);

    if (!resolvedPath.startsWith(logsDir + win32.sep)) {
        throw new Error('Invalid fileName: path traversal detected');
    }
    return resolvedPath;
}
