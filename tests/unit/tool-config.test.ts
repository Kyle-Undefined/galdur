import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/constants';
import { ClaudeTool } from '../../src/tools/ClaudeTool';
import { CodexTool } from '../../src/tools/CodexTool';
import { GeminiTool } from '../../src/tools/GeminiTool';
import { OpenCodeTool } from '../../src/tools/OpenCodeTool';
import type { CodexPermissionMode, GeminiPermissionMode, OpenCodePermissionMode, VaultPaths } from '../../src/types';

function cloneSettings() {
    return structuredClone(DEFAULT_SETTINGS);
}

function createVaultPaths(): VaultPaths {
    return {
        vaultPath: 'C:\\vault',
        configDir: '.obsidian',
        pluginDir: 'C:\\vault\\.obsidian\\plugins\\galdur',
    };
}

test('ClaudeTool.buildArgs returns only extra args when debug logging is off and permission mode is default', () => {
    const tool = new ClaudeTool();
    const settings = cloneSettings();
    settings.toolProfiles.claude.extraArgs = '--model sonnet\n--verbose';

    const args = tool.buildArgs(settings);

    assert.deepEqual(args, ['--model', 'sonnet', '--verbose']);
});

test('ClaudeTool.buildArgs prepends debug logging args when enabled', () => {
    const tool = new ClaudeTool();
    const settings = cloneSettings();
    settings.toolProfiles.claude.debugLoggingEnabled = true;

    const args = tool.buildArgs(settings, tool.getDebugLogPath(createVaultPaths()));

    assert.deepEqual(args, ['--debug-file', 'C:\\vault\\.obsidian\\plugins\\galdur\\logs\\claude-debug.log']);
});

test('ClaudeTool.buildArgs includes permission mode only when it is non-default', () => {
    const tool = new ClaudeTool();
    const settings = cloneSettings();
    settings.toolProfiles.claude.permissionMode = 'plan';

    const args = tool.buildArgs(settings);

    assert.deepEqual(args, ['--permission-mode', 'plan']);
});

test('ClaudeTool.buildArgs appends extra args last so user args can override earlier flags', () => {
    const tool = new ClaudeTool();
    const settings = cloneSettings();
    settings.toolProfiles.claude.debugLoggingEnabled = true;
    settings.toolProfiles.claude.permissionMode = 'acceptEdits';
    settings.toolProfiles.claude.extraArgs = '--permission-mode default\n--append-system-prompt "keep changes small"';

    const args = tool.buildArgs(settings, 'C:\\debug.log');

    assert.deepEqual(args, [
        '--debug-file',
        'C:\\debug.log',
        '--permission-mode',
        'acceptEdits',
        '--permission-mode',
        'default',
        '--append-system-prompt',
        'keep changes small',
    ]);
});

const codexPermissionCases: Array<{ mode: CodexPermissionMode; expected: string[] }> = [
    { mode: 'default', expected: [] },
    { mode: 'readOnly', expected: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'] },
    { mode: 'workspaceWrite', expected: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'] },
    { mode: 'workspaceWriteNever', expected: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'] },
    { mode: 'fullAuto', expected: ['--full-auto'] },
    { mode: 'dangerFullAccess', expected: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'on-request'] },
    { mode: 'bypassApprovalsAndSandbox', expected: ['--dangerously-bypass-approvals-and-sandbox'] },
];

for (const { mode, expected } of codexPermissionCases) {
    test(`CodexTool.buildArgs maps ${mode} permission mode to the expected flags`, () => {
        const tool = new CodexTool();
        const settings = cloneSettings();
        settings.toolProfiles.codex.permissionMode = mode;

        const args = tool.buildArgs(settings);

        assert.deepEqual(args, expected);
    });
}

test('CodexTool.buildArgs appends extra args after permission-derived flags', () => {
    const tool = new CodexTool();
    const settings = cloneSettings();
    settings.toolProfiles.codex.permissionMode = 'dangerFullAccess';
    settings.toolProfiles.codex.extraArgs = '--model gpt-5\n--search';

    const args = tool.buildArgs(settings);

    assert.deepEqual(args, [
        '--sandbox',
        'danger-full-access',
        '--ask-for-approval',
        'on-request',
        '--model',
        'gpt-5',
        '--search',
    ]);
});

const geminiPermissionCases: Array<{ mode: GeminiPermissionMode; expected: string[] }> = [
    { mode: 'default', expected: [] },
    { mode: 'sandbox', expected: ['--sandbox'] },
    { mode: 'autoEdit', expected: ['--approval-mode', 'auto_edit'] },
    { mode: 'sandboxAutoEdit', expected: ['--sandbox', '--approval-mode', 'auto_edit'] },
    { mode: 'plan', expected: ['--approval-mode', 'plan'] },
    { mode: 'sandboxPlan', expected: ['--sandbox', '--approval-mode', 'plan'] },
    { mode: 'yolo', expected: ['--approval-mode', 'yolo'] },
    { mode: 'sandboxYolo', expected: ['--sandbox', '--approval-mode', 'yolo'] },
];

for (const { mode, expected } of geminiPermissionCases) {
    test(`GeminiTool.buildArgs maps ${mode} permission mode to the expected flags`, () => {
        const tool = new GeminiTool();
        const settings = cloneSettings();
        settings.toolProfiles.gemini.permissionMode = mode;

        const args = tool.buildArgs(settings);

        assert.deepEqual(args, expected);
    });
}

test('GeminiTool.buildArgs appends extra args after permission-derived flags', () => {
    const tool = new GeminiTool();
    const settings = cloneSettings();
    settings.toolProfiles.gemini.permissionMode = 'sandboxYolo';
    settings.toolProfiles.gemini.extraArgs = '--model gemini-2.5-pro\n--debug';

    const args = tool.buildArgs(settings);

    assert.deepEqual(args, ['--sandbox', '--approval-mode', 'yolo', '--model', 'gemini-2.5-pro', '--debug']);
});

const openCodePermissionCases: Array<{
    mode: OpenCodePermissionMode;
    expectedArgs: string[];
    expectedEnv: NodeJS.ProcessEnv | undefined;
}> = [
    { mode: 'default', expectedArgs: [], expectedEnv: undefined },
    {
        mode: 'askOnEditAndBash',
        expectedArgs: [],
        expectedEnv: { OPENCODE_PERMISSION: '{"edit":"ask","bash":"ask"}' },
    },
    {
        mode: 'readOnly',
        expectedArgs: [],
        expectedEnv: { OPENCODE_PERMISSION: '{"edit":"deny","bash":"ask"}' },
    },
    {
        mode: 'askAll',
        expectedArgs: [],
        expectedEnv: { OPENCODE_PERMISSION: '{"*":"ask","external_directory":"ask","doom_loop":"ask"}' },
    },
    {
        mode: 'allowAll',
        expectedArgs: [],
        expectedEnv: { OPENCODE_PERMISSION: '{"*":"allow","external_directory":"allow","doom_loop":"allow"}' },
    },
];

for (const { mode, expectedArgs, expectedEnv } of openCodePermissionCases) {
    test(`OpenCodeTool maps ${mode} permission mode to the expected env override`, () => {
        const tool = new OpenCodeTool();
        const settings = cloneSettings();
        settings.toolProfiles.opencode.permissionMode = mode;

        const args = tool.buildArgs(settings);
        const env = tool.getSpawnEnvOverrides(settings);

        assert.deepEqual(args, expectedArgs);
        assert.deepEqual(env, expectedEnv);
    });
}

test('OpenCodeTool.buildArgs appends extra args without duplicating permission flags in argv', () => {
    const tool = new OpenCodeTool();
    const settings = cloneSettings();
    settings.toolProfiles.opencode.permissionMode = 'readOnly';
    settings.toolProfiles.opencode.extraArgs = '--model anthropic/claude-sonnet-4\n--print-logs';

    const args = tool.buildArgs(settings);
    const env = tool.getSpawnEnvOverrides(settings);

    assert.deepEqual(args, ['--model', 'anthropic/claude-sonnet-4', '--print-logs']);
    assert.deepEqual(env, { OPENCODE_PERMISSION: '{"edit":"deny","bash":"ask"}' });
});
