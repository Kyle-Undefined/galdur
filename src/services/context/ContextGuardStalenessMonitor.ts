import { App, EventRef } from 'obsidian';
import { normalizeConfiguredTags } from '../../settings/settingsHelpers';
import { GaldurSettings, ResolvedContextGuard } from '../../types';
import { extractTagsFromCache, normalizeVaultRelativePath } from './TagContextGuardService';
import {
    EventSource,
    getCachedFileMetadata,
    getFileLikePath,
    getMetadataEventSource,
    getVaultEventSource,
    isMarkdownFileLike,
} from './obsidianContextGuardAdapter';

type ContextGuardSnapshot = Pick<ResolvedContextGuard, 'excludedTags' | 'excludedNotePaths'>;
type PendingChange =
    | { kind: 'delete'; path: string }
    | { kind: 'rename'; oldPath: string; newPath: string }
    | { kind: 'upsert'; path: string };

type ContextGuardStalenessMonitorDeps = {
    app: App;
    getSettings: () => GaldurSettings;
    getSessionSnapshot: () => ContextGuardSnapshot | null;
    onStale: (current: ContextGuardSnapshot) => void;
    debounceMs?: number;
};

export class ContextGuardStalenessMonitor {
    private readonly subscriptions: Array<{ source: EventSource; ref: EventRef }> = [];
    private readonly trackedExcludedNotePaths = new Set<string>();
    private pendingChanges: PendingChange[] = [];
    private pendingResolvedPaths = new Set<string>();
    private trackedSnapshotSignature: string | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private staleNotified = false;

    public constructor(private readonly deps: ContextGuardStalenessMonitorDeps) {}

    public start(): void {
        if (this.subscriptions.length > 0) {
            return;
        }
        this.subscribe(getVaultEventSource(this.deps.app), 'create', (file) => {
            const path = getNormalizedFilePath(file);
            if (path && isMarkdownFileLike(file)) {
                this.scheduleCheck({
                    kind: 'upsert',
                    path,
                });
            }
        });
        this.subscribe(getVaultEventSource(this.deps.app), 'delete', (file) => {
            const path = getNormalizedFilePath(file);
            if (path && isMarkdownFileLike(file)) {
                this.scheduleCheck({
                    kind: 'delete',
                    path,
                });
            }
        });
        this.subscribe(getVaultEventSource(this.deps.app), 'rename', (file, oldPath) => {
            const newPath = getNormalizedFilePath(file);
            const previousPath = normalizeChangePath(oldPath);
            if (newPath && previousPath && (isMarkdownFileLike(file) || isMarkdownLikePath(previousPath))) {
                this.scheduleCheck({
                    kind: 'rename',
                    oldPath: previousPath,
                    newPath,
                });
            } else if (newPath && isMarkdownFileLike(file)) {
                this.scheduleCheck({ kind: 'upsert', path: newPath });
            } else if (previousPath && isMarkdownLikePath(previousPath)) {
                this.scheduleCheck({ kind: 'delete', path: previousPath });
            }
        });
        this.subscribe(getMetadataEventSource(this.deps.app), 'changed', (file) => {
            const path = getNormalizedFilePath(file);
            if (path && isMarkdownFileLike(file)) {
                this.scheduleCheck({
                    kind: 'upsert',
                    path,
                });
            }
        });
        this.subscribe(getMetadataEventSource(this.deps.app), 'resolved', () => {
            this.scheduleCheck();
        });
    }

    public stop(): void {
        try {
            for (const { source, ref } of this.subscriptions.splice(0)) {
                try {
                    source.offref(ref);
                } catch {
                    // Just eat it
                }
            }
        } finally {
            this.pendingChanges = [];
            this.pendingResolvedPaths.clear();
            this.trackedExcludedNotePaths.clear();
            this.trackedSnapshotSignature = null;
            this.clearTimer();
            this.staleNotified = false;
        }
    }

    public reset(): void {
        this.pendingChanges = [];
        this.pendingResolvedPaths.clear();
        this.trackedExcludedNotePaths.clear();
        this.trackedSnapshotSignature = null;
        this.staleNotified = false;
        this.clearTimer();
    }

    private subscribe(source: EventSource, eventName: string, callback: (...args: unknown[]) => void): void {
        const ref = source.on(eventName, callback);
        this.subscriptions.push({ source, ref });
    }

    private scheduleCheck(change?: PendingChange): void {
        if (this.staleNotified) {
            return;
        }

        const snapshot = this.deps.getSessionSnapshot();
        const excludedTags = normalizeConfiguredTags(this.deps.getSettings().excludedNoteTags);
        if (!snapshot || excludedTags.length === 0) {
            return;
        }

        this.syncTrackedState(snapshot);
        if (change) {
            this.pendingChanges.push(change);
        } else if (this.pendingResolvedPaths.size > 0) {
            for (const path of this.pendingResolvedPaths) {
                this.pendingChanges.push({ kind: 'upsert', path });
            }
            this.pendingResolvedPaths.clear();
        }

        if (this.pendingChanges.length === 0) {
            return;
        }

        this.clearTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            this.checkForChanges();
        }, this.deps.debounceMs ?? 250);
    }

    private checkForChanges(): void {
        if (this.staleNotified) {
            return;
        }

        const sessionSnapshot = this.deps.getSessionSnapshot();
        const excludedTags = normalizeConfiguredTags(this.deps.getSettings().excludedNoteTags);
        if (!sessionSnapshot || excludedTags.length === 0) {
            this.pendingChanges = [];
            this.pendingResolvedPaths.clear();
            return;
        }

        this.syncTrackedState(sessionSnapshot);
        const excludedTagSet = new Set(excludedTags);
        for (const change of this.pendingChanges.splice(0)) {
            this.applyChange(change, excludedTagSet);
        }

        const current = {
            excludedTags,
            excludedNotePaths: [...this.trackedExcludedNotePaths].sort((left, right) => left.localeCompare(right)),
        };
        if (buildSnapshotSignature(sessionSnapshot) === buildSnapshotSignature(current)) {
            return;
        }

        this.staleNotified = true;
        this.deps.onStale(current);
    }

    private syncTrackedState(snapshot: ContextGuardSnapshot): void {
        const signature = buildSnapshotSignature(snapshot);
        if (this.trackedSnapshotSignature === signature) {
            return;
        }

        this.trackedSnapshotSignature = signature;
        this.trackedExcludedNotePaths.clear();
        for (const path of snapshot.excludedNotePaths) {
            this.trackedExcludedNotePaths.add(normalizeVaultRelativePath(path));
        }
    }

    private applyChange(change: PendingChange, excludedTagSet: ReadonlySet<string>): void {
        switch (change.kind) {
            case 'delete':
                this.trackedExcludedNotePaths.delete(change.path);
                return;
            case 'rename':
                this.trackedExcludedNotePaths.delete(change.oldPath);
                if (isMarkdownLikePath(change.newPath)) {
                    this.applyUpsert(change.newPath, excludedTagSet);
                    return;
                }

                this.pendingResolvedPaths.delete(change.newPath);
                return;
            case 'upsert':
                this.applyUpsert(change.path, excludedTagSet);
                return;
        }
    }

    private applyUpsert(path: string, excludedTagSet: ReadonlySet<string>): void {
        const isExcluded = this.isCurrentlyExcluded(path, excludedTagSet);
        if (isExcluded === null) {
            this.pendingResolvedPaths.add(path);
            return;
        }

        this.pendingResolvedPaths.delete(path);
        if (isExcluded) {
            this.trackedExcludedNotePaths.add(path);
            return;
        }
        this.trackedExcludedNotePaths.delete(path);
    }

    private isCurrentlyExcluded(path: string, excludedTagSet: ReadonlySet<string>): boolean | null {
        const cache = getCachedFileMetadata(this.deps.app, path);
        if (!cache) {
            return null;
        }
        return extractTagsFromCache(cache).some((tag) => excludedTagSet.has(tag));
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

function buildSnapshotSignature(snapshot: ContextGuardSnapshot): string {
    return JSON.stringify({
        excludedTags: [...snapshot.excludedTags].sort(),
        excludedNotePaths: [...snapshot.excludedNotePaths].sort(),
    });
}

function isMarkdownLikePath(value: unknown): boolean {
    return typeof value === 'string' && value.toLowerCase().endsWith('.md');
}

function getNormalizedFilePath(value: unknown): string | null {
    return normalizeChangePath(getFileLikePath(value));
}

function normalizeChangePath(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = normalizeVaultRelativePath(value).trim();
    return normalized.length > 0 ? normalized : null;
}
