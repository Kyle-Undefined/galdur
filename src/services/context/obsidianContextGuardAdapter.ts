import { App, EventRef } from 'obsidian';
import { CachedFileMetadata } from './TagContextGuardService';

export type EventSource = {
    on(name: string, callback: (...args: unknown[]) => void): EventRef;
    offref(ref: EventRef): void;
};

type FileLike = {
    path: string;
    extension?: string;
};

export function getVaultEventSource(app: App): EventSource {
    return app.vault as unknown as EventSource;
}

export function getMetadataEventSource(app: App): EventSource {
    return app.metadataCache as unknown as EventSource;
}

export function getCachedFileMetadata(app: App, path: string): CachedFileMetadata | null {
    return (
        app.metadataCache as unknown as {
            getFileCache(file: FileLike): CachedFileMetadata | null;
        }
    ).getFileCache({ path });
}

export function getFileLikePath(value: unknown): string {
    if (!isFileLike(value)) {
        return '';
    }
    return value.path;
}

export function isMarkdownFileLike(value: unknown): boolean {
    if (!isFileLike(value)) {
        return false;
    }
    if (typeof value.extension === 'string') {
        return value.extension.toLowerCase() === 'md';
    }
    return value.path.toLowerCase().endsWith('.md');
}

function isFileLike(value: unknown): value is FileLike {
    return Boolean(value) && typeof value === 'object' && typeof (value as FileLike).path === 'string';
}
