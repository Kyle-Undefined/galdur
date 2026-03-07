import { App, Platform } from 'obsidian';

export function getVaultPath(app: App): string {
    if (!Platform.isDesktop) {
        throw new Error('Galdur requires a desktop platform to resolve the vault path');
    }
    const adapter = app.vault.adapter as unknown as Record<string, unknown>;
    if (typeof adapter.getBasePath === 'function') {
        return (adapter.getBasePath as () => string)();
    }
    throw new Error('Unable to resolve vault path: adapter does not support getBasePath');
}
