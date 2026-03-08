import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { DEFAULT_SETTINGS } from '../../src/constants';
import { TagContextGuardService } from '../../src/services/context/TagContextGuardService';
import type { GaldurSettings, VaultPaths } from '../../src/types';
import { createTempDir, removeTempDir } from '../helpers/tempDir';

function cloneSettings(): GaldurSettings {
    return structuredClone(DEFAULT_SETTINGS);
}

function createVaultPaths(
    vaultPath: string,
    pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur')
): VaultPaths {
    return {
        vaultPath,
        configDir: '.obsidian',
        pluginDir,
    };
}

function createMockApp(fileCacheByPath: Map<string, unknown>, filePaths = [...fileCacheByPath.keys()]) {
    return {
        vault: {
            getMarkdownFiles: () => filePaths.map((path) => ({ path })),
        },
        metadataCache: {
            getFileCache: (file: { path: string }) => fileCacheByPath.get(file.path) ?? null,
        },
    } as any;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

test('TagContextGuardService resolves excluded notes from frontmatter and inline tags for Claude', async () => {
    const vaultPath = await createTempDir();
    const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur');
    const settings = cloneSettings();
    settings.excludedNoteTags = ['#Private', 'system', 'PRIVATE'];
    settings.toolProfiles.claude.debugLoggingEnabled = true;
    const service = new TagContextGuardService(
        createMockApp(
            new Map<string, unknown>([
                ['notes/frontmatter-array.md', { frontmatter: { tags: ['Private', 'other'] } }],
                ['notes/frontmatter-string.md', { frontmatter: { tags: 'system' } }],
                ['notes/inline.md', { tags: [{ tag: '#private' }] }],
            ])
        )
    );

    try {
        const result = await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'claude');

        assert.deepEqual(result.excludedTags, ['private', 'system']);
        assert.deepEqual(result.excludedNotePaths, [
            'notes/frontmatter-array.md',
            'notes/frontmatter-string.md',
            'notes/inline.md',
        ]);
        assert.equal(result.supportLevel, 'enforced');
        assert.deepEqual(result.toolArgs, ['--settings', join(pluginDir, 'context-guard', 'claude-settings.json')]);

        const excludedNotesJson = JSON.parse(
            await readFile(join(pluginDir, 'context-guard', 'excluded-notes.json'), 'utf8')
        ) as {
            excludedTags: string[];
            excludedNotePaths: string[];
        };
        assert.deepEqual(excludedNotesJson.excludedTags, ['private', 'system']);
        assert.deepEqual(excludedNotesJson.excludedNotePaths, result.excludedNotePaths);

        const claudeSettings = JSON.parse(
            await readFile(join(pluginDir, 'context-guard', 'claude-settings.json'), 'utf8')
        ) as {
            permissions: { deny: string[] };
        };
        assert.deepEqual(claudeSettings.permissions.deny, [
            'Read(./notes/frontmatter-array.md)',
            'Edit(./notes/frontmatter-array.md)',
            'Read(./notes/frontmatter-string.md)',
            'Edit(./notes/frontmatter-string.md)',
            'Read(./notes/inline.md)',
            'Edit(./notes/inline.md)',
            'Read(./.obsidian/plugins/galdur/context-guard/excluded-notes.json)',
            'Edit(./.obsidian/plugins/galdur/context-guard/excluded-notes.json)',
            'Read(./.obsidian/plugins/galdur/context-guard/claude-settings.json)',
            'Edit(./.obsidian/plugins/galdur/context-guard/claude-settings.json)',
        ]);
    } finally {
        await removeTempDir(vaultPath);
    }
});

test('TagContextGuardService generates Gemini policy denies for excluded paths', async () => {
    const vaultPath = await createTempDir();
    const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur');
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    settings.toolProfiles.gemini.debugLoggingEnabled = false;
    const service = new TagContextGuardService(
        createMockApp(new Map<string, unknown>([['notes/private file.md', { frontmatter: { tags: ['private'] } }]]))
    );

    try {
        const result = await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'gemini');

        assert.equal(result.supportLevel, 'partial');
        assert.deepEqual(result.toolArgs, ['--policy', join(pluginDir, 'context-guard', 'gemini-policy.toml')]);

        const geminiPolicy = await readFile(join(pluginDir, 'context-guard', 'gemini-policy.toml'), 'utf8');
        assert.match(geminiPolicy, /toolName = "read_file"/);
        assert.match(geminiPolicy, /toolName = "list_directory"/);
        assert.match(geminiPolicy, /decision = "deny"/);
        assert.ok(
            geminiPolicy.includes('(?:\\\\.[\\\\\\\\/])?notes(?:\\\\\\\\|/)private file\\\\.md'),
            'Expected gemini-policy.toml to contain escaped path pattern for "notes/private file.md"'
        );
        assert.match(geminiPolicy, /context-guard/);
        assert.match(geminiPolicy, /gemini-policy\\\\\.toml/);
        assert.equal(await pathExists(join(pluginDir, 'context-guard', 'excluded-notes.json')), false);
    } finally {
        await removeTempDir(vaultPath);
    }
});

test('TagContextGuardService falls back to advisory mode for unsupported tools', async () => {
    const vaultPath = await createTempDir();
    const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur');
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const service = new TagContextGuardService(
        createMockApp(new Map<string, unknown>([['notes/private.md', { frontmatter: { tags: ['private'] } }]]))
    );

    try {
        const result = await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'codex');

        assert.equal(result.supportLevel, 'advisory');
        assert.deepEqual(result.toolArgs, []);
        assert.match(
            result.supportMessage,
            /1 tagged note marked advisory only; Codex has no native deny rules applied\./
        );
    } finally {
        await removeTempDir(vaultPath);
    }
});

test('TagContextGuardService reports none when tags are configured but no metadata matches', async () => {
    const vaultPath = await createTempDir();
    const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur');
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const service = new TagContextGuardService(createMockApp(new Map<string, unknown>()));

    try {
        const result = await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'claude');

        assert.equal(result.supportLevel, 'none');
        assert.deepEqual(result.excludedNotePaths, []);
        assert.deepEqual(result.toolArgs, []);
        assert.equal(result.supportMessage, 'No tagged notes matched current vault metadata.');
    } finally {
        await removeTempDir(vaultPath);
    }
});

test('TagContextGuardService removes stale excluded-notes debug artifact when debug logging is off', async () => {
    const vaultPath = await createTempDir();
    const pluginDir = join(vaultPath, '.obsidian', 'plugins', 'galdur');
    const settings = cloneSettings();
    settings.excludedNoteTags = ['private'];
    const service = new TagContextGuardService(
        createMockApp(new Map<string, unknown>([['notes/private.md', { frontmatter: { tags: ['private'] } }]]))
    );

    try {
        settings.toolProfiles.claude.debugLoggingEnabled = true;
        await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'claude');
        assert.equal(await pathExists(join(pluginDir, 'context-guard', 'excluded-notes.json')), true);

        settings.toolProfiles.claude.debugLoggingEnabled = false;
        await service.resolve(settings, createVaultPaths(vaultPath, pluginDir), 'claude');
        assert.equal(await pathExists(join(pluginDir, 'context-guard', 'excluded-notes.json')), false);
    } finally {
        await removeTempDir(vaultPath);
    }
});
