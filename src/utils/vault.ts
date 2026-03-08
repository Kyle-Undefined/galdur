import { join } from 'path';
import { App, FileSystemAdapter, Platform } from 'obsidian';
import { PLUGINS_DIR, PLUGIN_ID } from '../constants';
import { VaultPaths } from '../types';

export function createVaultPaths(vaultPath: string, configDir: string): VaultPaths {
    return {
        vaultPath,
        configDir,
        pluginDir: join(vaultPath, configDir, PLUGINS_DIR, PLUGIN_ID),
    };
}

export function getVaultPaths(app: App): VaultPaths {
    if (!Platform.isDesktop) {
        throw new Error('Galdur requires a desktop platform to resolve the vault path');
    }
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
        return createVaultPaths(adapter.getBasePath(), app.vault.configDir);
    }
    throw new Error('Unable to resolve vault path: adapter does not support desktop filesystem access');
}
