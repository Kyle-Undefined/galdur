import { mkdir, rm, writeFile } from 'fs/promises';
import { join, relative } from 'path';
import { App } from 'obsidian';
import { normalizeConfiguredTag, normalizeConfiguredTags } from '../../settings/settingsHelpers';
import { GaldurSettings, ResolvedContextGuard, ToolId, VaultPaths } from '../../types';

const CONTEXT_GUARD_DIR = 'context-guard';
const EXCLUDED_NOTES_FILE = 'excluded-notes.json';
const CLAUDE_SETTINGS_FILE = 'claude-settings.json';
const GEMINI_POLICY_FILE = 'gemini-policy.toml';

const GEMINI_RULE_TOOLS = [
    'read_file',
    'read_many_files',
    'replace',
    'write_file',
    'grep_search',
    'glob',
    'list_directory',
] as const;

export class TagContextGuardService {
    public constructor(private readonly app: App) {}

    public getExcludedState(
        settings: GaldurSettings
    ): Pick<ResolvedContextGuard, 'excludedTags' | 'excludedNotePaths'> {
        const excludedTags = normalizeConfiguredTags(settings.excludedNoteTags);
        const excludedNotePaths = this.getExcludedNotePaths(excludedTags);
        return {
            excludedTags,
            excludedNotePaths,
        };
    }

    public async resolve(
        settings: GaldurSettings,
        vaultPaths: VaultPaths,
        toolId: ToolId
    ): Promise<ResolvedContextGuard> {
        const { excludedTags, excludedNotePaths } = this.getExcludedState(settings);
        const shouldWriteDebugArtifact = settings.toolProfiles[toolId].debugLoggingEnabled;
        if (!shouldWriteDebugArtifact) {
            await this.removeExcludedNotesArtifact(vaultPaths);
        }

        if (excludedTags.length === 0) {
            return {
                excludedTags,
                excludedNotePaths,
                toolArgs: [],
                supportLevel: 'none',
                supportMessage: 'Global tag guard is off.',
            };
        }

        if (excludedNotePaths.length === 0) {
            if (shouldWriteDebugArtifact) {
                const guardDir = await this.ensureGuardDir(vaultPaths);
                await this.writeExcludedNotesFile(guardDir, excludedTags, excludedNotePaths);
            }
            return {
                excludedTags,
                excludedNotePaths,
                toolArgs: [],
                supportLevel: 'none',
                supportMessage: 'No tagged notes matched current vault metadata.',
            };
        }

        switch (toolId) {
            case 'claude':
                return await this.buildClaudeGuard(
                    vaultPaths,
                    excludedTags,
                    excludedNotePaths,
                    shouldWriteDebugArtifact
                );
            case 'gemini':
                return await this.buildGeminiGuard(
                    vaultPaths,
                    excludedTags,
                    excludedNotePaths,
                    shouldWriteDebugArtifact
                );
            default:
                if (shouldWriteDebugArtifact) {
                    const guardDir = await this.ensureGuardDir(vaultPaths);
                    await this.writeExcludedNotesFile(guardDir, excludedTags, excludedNotePaths);
                }
                return {
                    excludedTags,
                    excludedNotePaths,
                    toolArgs: [],
                    supportLevel: 'advisory',
                    supportMessage: `${formatNoteCount(
                        excludedNotePaths.length
                    )} marked advisory only; ${getToolDisplayName(toolId)} has no native deny rules applied.`,
                };
        }
    }

    private getExcludedNotePaths(excludedTags: string[]): string[] {
        if (excludedTags.length === 0) {
            return [];
        }

        const excludedTagSet = new Set(excludedTags);
        const matches: string[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) {
                continue;
            }

            const fileTags = extractTagsFromCache(cache);
            if (fileTags.some((tag) => excludedTagSet.has(tag))) {
                matches.push(normalizeVaultRelativePath(file.path));
            }
        }

        return matches.sort((left, right) => left.localeCompare(right));
    }

    private async ensureGuardDir(vaultPaths: VaultPaths): Promise<string> {
        const guardDir = join(vaultPaths.pluginDir, CONTEXT_GUARD_DIR);
        try {
            await mkdir(guardDir, { recursive: true });
        } catch (error) {
            throw wrapFsError('create context guard directory', guardDir, error);
        }
        return guardDir;
    }

    private async writeExcludedNotesFile(
        guardDir: string,
        excludedTags: string[],
        excludedNotePaths: string[]
    ): Promise<void> {
        const excludedNotesPath = join(guardDir, EXCLUDED_NOTES_FILE);
        try {
            await writeFile(
                excludedNotesPath,
                JSON.stringify(
                    {
                        excludedTags,
                        excludedNotePaths,
                    },
                    null,
                    2
                ),
                'utf8'
            );
        } catch (error) {
            throw wrapFsError('write excluded notes artifact', excludedNotesPath, error);
        }
    }

    private async removeExcludedNotesArtifact(vaultPaths: VaultPaths): Promise<void> {
        const excludedNotesPath = join(vaultPaths.pluginDir, CONTEXT_GUARD_DIR, EXCLUDED_NOTES_FILE);
        await rm(excludedNotesPath, { force: true });
    }

    private async buildClaudeGuard(
        vaultPaths: VaultPaths,
        excludedTags: string[],
        excludedNotePaths: string[],
        shouldWriteDebugArtifact: boolean
    ): Promise<ResolvedContextGuard> {
        const guardDir = await this.ensureGuardDir(vaultPaths);
        const protectedArtifactPaths: string[] = [];
        if (shouldWriteDebugArtifact) {
            await this.writeExcludedNotesFile(guardDir, excludedTags, excludedNotePaths);
            protectedArtifactPaths.push(toVaultRelativeArtifactPath(vaultPaths, join(guardDir, EXCLUDED_NOTES_FILE)));
        }
        const settingsPath = join(guardDir, CLAUDE_SETTINGS_FILE);
        protectedArtifactPaths.push(toVaultRelativeArtifactPath(vaultPaths, settingsPath));
        const denyRules = [...excludedNotePaths, ...protectedArtifactPaths].flatMap((path) => [
            `Read(${toClaudePermissionPath(path)})`,
            `Edit(${toClaudePermissionPath(path)})`,
        ]);

        try {
            await writeFile(
                settingsPath,
                JSON.stringify(
                    {
                        permissions: {
                            deny: denyRules,
                        },
                    },
                    null,
                    2
                ),
                'utf8'
            );
        } catch (error) {
            throw wrapFsError('write Claude context guard settings', settingsPath, error);
        }

        return {
            excludedTags,
            excludedNotePaths,
            toolArgs: ['--settings', settingsPath],
            supportLevel: 'enforced',
            supportMessage: `${formatNoteCount(excludedNotePaths.length)} hidden via generated Claude permissions.`,
        };
    }

    private async buildGeminiGuard(
        vaultPaths: VaultPaths,
        excludedTags: string[],
        excludedNotePaths: string[],
        shouldWriteDebugArtifact: boolean
    ): Promise<ResolvedContextGuard> {
        const guardDir = await this.ensureGuardDir(vaultPaths);
        const protectedArtifactPaths: string[] = [];
        if (shouldWriteDebugArtifact) {
            await this.writeExcludedNotesFile(guardDir, excludedTags, excludedNotePaths);
            protectedArtifactPaths.push(toVaultRelativeArtifactPath(vaultPaths, join(guardDir, EXCLUDED_NOTES_FILE)));
        }
        const policyPath = join(guardDir, GEMINI_POLICY_FILE);
        protectedArtifactPaths.push(toVaultRelativeArtifactPath(vaultPaths, policyPath));
        const argsPattern = buildGeminiArgsPattern([...excludedNotePaths, ...protectedArtifactPaths]);
        const rules = GEMINI_RULE_TOOLS.map(
            (toolName, index) =>
                `[[rule]]
toolName = "${toolName}"
argsPattern = "${escapeTomlString(argsPattern)}"
decision = "deny"
priority = ${200 + index}
deny_message = "Access to tag-guarded notes is restricted by Galdur context guard."
`
        ).join('\n');

        try {
            await writeFile(policyPath, `${rules}\n`, 'utf8');
        } catch (error) {
            throw wrapFsError('write Gemini context guard policy', policyPath, error);
        }

        return {
            excludedTags,
            excludedNotePaths,
            toolArgs: ['--policy', policyPath],
            supportLevel: 'partial',
            supportMessage: `${formatNoteCount(excludedNotePaths.length)} partially guarded; shell access is not blocked.`,
        };
    }
}

export type CachedFileMetadata = {
    frontmatter?: { tags?: unknown };
    tags?: Array<{ tag?: unknown }>;
};

export function extractTagsFromCache(cache: CachedFileMetadata): string[] {
    const tags = new Set<string>();
    const frontmatterTags = cache.frontmatter?.tags;
    if (Array.isArray(frontmatterTags)) {
        for (const entry of frontmatterTags) {
            const normalized = normalizeConfiguredTag(entry);
            if (normalized) {
                tags.add(normalized);
            }
        }
    } else {
        const normalized = normalizeConfiguredTag(frontmatterTags);
        if (normalized) {
            tags.add(normalized);
        }
    }

    for (const entry of cache.tags ?? []) {
        const normalized = normalizeConfiguredTag(entry?.tag);
        if (normalized) {
            tags.add(normalized);
        }
    }

    return [...tags];
}

export function normalizeVaultRelativePath(path: string): string {
    return path.replace(/\\/g, '/');
}

function toVaultRelativeArtifactPath(vaultPaths: VaultPaths, path: string): string {
    return normalizeVaultRelativePath(relative(vaultPaths.vaultPath, path));
}

function toClaudePermissionPath(path: string): string {
    return `./${normalizeVaultRelativePath(path)}`;
}

function buildGeminiArgsPattern(paths: readonly string[]): string {
    const exactPatterns = paths.map((path) => {
        const separatorAgnosticPath = normalizeVaultRelativePath(path)
            .split('/')
            .map((segment) => escapeRegex(segment))
            .join(String.raw`(?:\\|/)`);
        return String.raw`(?:\.[\\/])?${separatorAgnosticPath}`;
    });

    return String.raw`(?:^|[\s"'=:\[{,(])(?:${exactPatterns.join('|')})(?=$|[\s"'\]}),])`;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeTomlString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

function getToolDisplayName(toolId: ToolId): string {
    switch (toolId) {
        case 'codex':
            return 'Codex';
        case 'opencode':
            return 'OpenCode';
        default:
            return toolId[0].toUpperCase() + toolId.slice(1);
    }
}

function formatNoteCount(count: number): string {
    return `${count} tagged ${count === 1 ? 'note' : 'notes'}`;
}

function wrapFsError(action: string, path: string, error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`Failed to ${action} at ${path}: ${detail}`);
}
