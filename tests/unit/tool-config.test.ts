import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../src/constants';
import { ClaudeTool } from '../../src/tools/ClaudeTool';
import { CodexTool } from '../../src/tools/CodexTool';
import type { ToolPermissionMode } from '../../src/types';

function cloneSettings() {
    return structuredClone(DEFAULT_SETTINGS);
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

    const args = tool.buildArgs(settings, 'C:\\vault\\.obsidian\\plugins\\galdur\\claude-debug.log');

    assert.deepEqual(args, ['--debug-file', 'C:\\vault\\.obsidian\\plugins\\galdur\\claude-debug.log']);
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

const codexPermissionCases: Array<{ mode: ToolPermissionMode; expected: string[] }> = [
    { mode: 'default', expected: [] },
    { mode: 'acceptEdits', expected: ['--full-auto'] },
    { mode: 'bypassPermissions', expected: ['--dangerously-bypass-approvals-and-sandbox'] },
    { mode: 'delegate', expected: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'on-request'] },
    { mode: 'dontAsk', expected: ['--sandbox', 'workspace-write', '--ask-for-approval', 'never'] },
    { mode: 'plan', expected: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'] },
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
    settings.toolProfiles.codex.permissionMode = 'delegate';
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
