import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextGuardStalenessMonitor } from '../../src/services/context/ContextGuardStalenessMonitor';
import { DEFAULT_SETTINGS } from '../../src/constants';
import type { GaldurSettings } from '../../src/types';

function cloneSettings(): GaldurSettings {
    return structuredClone(DEFAULT_SETTINGS);
}

function createEmitter() {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    return {
        on(name: string, callback: (...args: unknown[]) => void) {
            const existing = listeners.get(name) ?? [];
            existing.push(callback);
            listeners.set(name, existing);
            return { name, callback } as { name: string; callback: (...args: unknown[]) => void };
        },
        offref(ref: { name: string; callback: (...args: unknown[]) => void }) {
            const existing = listeners.get(ref.name) ?? [];
            listeners.set(
                ref.name,
                existing.filter((entry) => entry !== ref.callback)
            );
        },
        emit(name: string, ...args: unknown[]) {
            for (const callback of listeners.get(name) ?? []) {
                callback(...args);
            }
        },
    };
}

test('ContextGuardStalenessMonitor notifies once when the excluded note set changes', async () => {
    const vaultEmitter = createEmitter();
    const metadataEmitter = createEmitter();
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const fileCacheByPath = new Map<string, unknown>([['notes/private.md', { frontmatter: { tags: ['private'] } }]]);
    const app = {
        vault: {
            ...vaultEmitter,
            getMarkdownFiles: () => [...fileCacheByPath.keys()].map((path) => ({ path, extension: 'md' })),
        },
        metadataCache: {
            ...metadataEmitter,
            getFileCache: (file: { path: string }) => fileCacheByPath.get(file.path) ?? null,
        },
    } as any;

    const staleStates: Array<{ excludedTags: string[]; excludedNotePaths: string[] }> = [];
    const monitor = new ContextGuardStalenessMonitor({
        app,
        getSettings: () => settings,
        getSessionSnapshot: () => ({
            excludedTags: ['private'],
            excludedNotePaths: ['notes/private.md'],
        }),
        onStale: (current) => {
            staleStates.push(current);
        },
        debounceMs: 0,
    });

    monitor.start();
    fileCacheByPath.set('notes/new-private.md', { frontmatter: { tags: ['private'] } });
    metadataEmitter.emit('changed', { path: 'notes/new-private.md', extension: 'md' });

    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(staleStates.length, 1);
    assert.deepEqual([...staleStates[0].excludedNotePaths].sort(), ['notes/new-private.md', 'notes/private.md'].sort());

    metadataEmitter.emit('changed', { path: 'notes/new-private.md', extension: 'md' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(staleStates.length, 1);
    monitor.stop();
});

test('ContextGuardStalenessMonitor ignores events when no session snapshot is active', async () => {
    const vaultEmitter = createEmitter();
    const metadataEmitter = createEmitter();
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const app = {
        vault: {
            ...vaultEmitter,
            getMarkdownFiles: () => [{ path: 'notes/private.md', extension: 'md' }],
        },
        metadataCache: {
            ...metadataEmitter,
            getFileCache: () => ({ frontmatter: { tags: ['private'] } }),
        },
    } as any;

    let staleCount = 0;
    const monitor = new ContextGuardStalenessMonitor({
        app,
        getSettings: () => settings,
        getSessionSnapshot: () => null,
        onStale: () => {
            staleCount += 1;
        },
        debounceMs: 0,
    });

    monitor.start();
    vaultEmitter.emit('create', { path: 'notes/private.md', extension: 'md' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(staleCount, 0);
    monitor.stop();
});

test('ContextGuardStalenessMonitor ignores markdown-like events without a valid path', async () => {
    const vaultEmitter = createEmitter();
    const metadataEmitter = createEmitter();
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const app = {
        vault: {
            ...vaultEmitter,
            getMarkdownFiles: () => [],
        },
        metadataCache: {
            ...metadataEmitter,
            getFileCache: () => ({ frontmatter: { tags: ['private'] } }),
        },
    } as any;

    let staleCount = 0;
    const monitor = new ContextGuardStalenessMonitor({
        app,
        getSettings: () => settings,
        getSessionSnapshot: () => ({
            excludedTags: ['private'],
            excludedNotePaths: [],
        }),
        onStale: () => {
            staleCount += 1;
        },
        debounceMs: 0,
    });

    monitor.start();
    metadataEmitter.emit('changed', { extension: 'md' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(staleCount, 0);
    monitor.stop();
});

test('ContextGuardStalenessMonitor does not keep rechecking renamed non-markdown paths', async () => {
    const vaultEmitter = createEmitter();
    const metadataEmitter = createEmitter();
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    let fileCacheLookups = 0;
    const app = {
        vault: {
            ...vaultEmitter,
            getMarkdownFiles: () => [],
        },
        metadataCache: {
            ...metadataEmitter,
            getFileCache: (file: { path: string }) => {
                fileCacheLookups += 1;
                return file.path === 'notes/note.md' ? { frontmatter: { tags: ['private'] } } : null;
            },
        },
    } as any;

    let staleCount = 0;
    const monitor = new ContextGuardStalenessMonitor({
        app,
        getSettings: () => settings,
        getSessionSnapshot: () => ({
            excludedTags: ['private'],
            excludedNotePaths: [],
        }),
        onStale: () => {
            staleCount += 1;
        },
        debounceMs: 0,
    });

    monitor.start();
    vaultEmitter.emit('rename', { path: 'notes/note.txt', extension: 'txt' }, 'notes/note.md');
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(fileCacheLookups, 0);
    assert.equal(staleCount, 0);

    metadataEmitter.emit('resolved');
    metadataEmitter.emit('resolved');
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(fileCacheLookups, 0);
    assert.equal(staleCount, 0);
    monitor.stop();
});
