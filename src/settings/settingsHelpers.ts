import {
    createDefaultToolProfile,
    DEFAULT_CONNECT_TIMEOUT_MS,
    isToolId,
    MAX_CONNECT_TIMEOUT_MS,
    MIN_CONNECT_TIMEOUT_MS,
    TOOL_OPTIONS,
} from '../constants';
import { getTool } from '../tools/toolRegistry';
import { GaldurSettings, ToolId, ToolLaunchProfile, ToolProfileRecord } from '../types';

export type SanitizedToolProfiles = {
    [K in ToolId]?: Partial<ToolLaunchProfile<K>>;
};

export type SanitizedLoadedSettings = Partial<
    Omit<GaldurSettings, 'excludedNoteTags' | 'runtimeConnectTimeoutMs' | 'toolProfiles'>
> & {
    excludedNoteTags?: string[];
    runtimeConnectTimeoutMs?: number;
    toolProfiles?: SanitizedToolProfiles;
};

export function mergeToolProfiles(loadedProfiles?: SanitizedToolProfiles): ToolProfileRecord {
    const merged = {} as ToolProfileRecord;
    for (const toolId of TOOL_OPTIONS) {
        setToolProfile(merged, toolId, {
            ...createDefaultToolProfile(toolId),
            ...loadedProfiles?.[toolId],
        });
    }
    return merged;
}

export function sanitizeLoadedSettings(value: unknown): SanitizedLoadedSettings {
    if (!isRecord(value)) {
        return {};
    }

    const sanitized: SanitizedLoadedSettings = {};
    if (isToolId(value.activeToolId)) {
        sanitized.activeToolId = value.activeToolId;
    }
    if (typeof value.runtimePath === 'string') {
        sanitized.runtimePath = value.runtimePath;
    }
    if (typeof value.runtimeVersion === 'string' || value.runtimeVersion === null) {
        sanitized.runtimeVersion = value.runtimeVersion;
    }
    if (typeof value.runtimeAutoStart === 'boolean') {
        sanitized.runtimeAutoStart = value.runtimeAutoStart;
    }
    if (typeof value.wslEnabled === 'boolean') {
        sanitized.wslEnabled = value.wslEnabled;
    }
    if (typeof value.wslDistro === 'string') {
        sanitized.wslDistro = value.wslDistro;
    }

    const excludedNoteTags = sanitizeConfiguredTags(value.excludedNoteTags);
    if (excludedNoteTags) {
        sanitized.excludedNoteTags = excludedNoteTags;
    }

    const runtimeConnectTimeoutMs = sanitizeConnectTimeoutMs(value.runtimeConnectTimeoutMs);
    if (runtimeConnectTimeoutMs !== undefined) {
        sanitized.runtimeConnectTimeoutMs = runtimeConnectTimeoutMs;
    }

    const toolProfiles = sanitizeToolProfiles(value.toolProfiles);
    if (toolProfiles) {
        sanitized.toolProfiles = toolProfiles;
    }

    return sanitized;
}

export function parseConfiguredTagsInput(value: string): string[] {
    return normalizeConfiguredTags(value.split(/\r?\n/));
}

export function normalizeConfiguredTags(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const tag of tags) {
        const value = normalizeConfiguredTag(tag);
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        normalized.push(value);
    }
    return normalized;
}

export function normalizeConfiguredTag(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().replace(/^#+/, '').toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

export function normalizeConnectTimeoutMs(value: number): number {
    return Math.min(MAX_CONNECT_TIMEOUT_MS, Math.max(MIN_CONNECT_TIMEOUT_MS, Math.trunc(value)));
}

export function sanitizeConnectTimeoutMs(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return normalizeConnectTimeoutMs(value);
}

export function getStoredConnectTimeoutMs(value: number | null | undefined): number {
    return normalizeConnectTimeoutMs(value ?? DEFAULT_CONNECT_TIMEOUT_MS);
}

function sanitizeConfiguredTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const normalized = normalizeConfiguredTags(value);
    return normalized.length > 0 ? normalized : undefined;
}

function sanitizeToolProfiles(value: unknown): SanitizedToolProfiles | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const sanitized: SanitizedToolProfiles = {};
    for (const toolId of TOOL_OPTIONS) {
        const profile = sanitizeToolProfile(toolId, value[toolId]);
        if (profile) {
            setToolProfile(sanitized, toolId, profile);
        }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function setToolProfile<TToolId extends ToolId, TProfiles extends { [K in ToolId]?: unknown }>(
    profiles: TProfiles,
    toolId: TToolId,
    profile: TProfiles[TToolId]
): void {
    profiles[toolId] = profile;
}

function sanitizeToolProfile<TToolId extends ToolId>(
    toolId: TToolId,
    value: unknown
): Partial<ToolLaunchProfile<TToolId>> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const profile: Partial<ToolLaunchProfile<TToolId>> = {};
    if (isPermissionMode(toolId, value.permissionMode)) {
        profile.permissionMode = value.permissionMode;
    }
    if (typeof value.extraArgs === 'string') {
        profile.extraArgs = value.extraArgs;
    }
    if (typeof value.debugLoggingEnabled === 'boolean') {
        profile.debugLoggingEnabled = value.debugLoggingEnabled;
    }

    return Object.keys(profile).length > 0 ? profile : undefined;
}

function isPermissionMode<TToolId extends ToolId>(
    toolId: TToolId,
    value: unknown
): value is ToolLaunchProfile<TToolId>['permissionMode'] {
    if (typeof value !== 'string') {
        return false;
    }

    const tool = getTool(toolId);
    return tool?.getSettingsSpec().permissionModes.some((mode) => mode.value === value) ?? false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
