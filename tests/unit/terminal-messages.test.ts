import test from 'node:test';
import assert from 'node:assert/strict';
import { writeContextGuardStaleWarning, writeStartupBanner } from '../../src/ui/terminal/terminalMessages';

function createTerminal() {
    const lines: string[] = [];
    return {
        lines,
        terminal: {
            writeln(value: string) {
                lines.push(value);
            },
        },
    };
}

test('writeStartupBanner includes context guard support details', () => {
    const { lines, terminal } = createTerminal();

    writeStartupBanner(terminal as any, {
        command: 'claude.exe',
        args: ['--model', 'sonnet'],
        commandSource: 'PATH',
        vaultPath: 'C:\\vault',
        toolDisplayName: 'Claude',
        debugLoggingEnabled: true,
        debugFilePath: 'C:\\vault\\.obsidian\\plugins\\galdur\\claude-debug.log',
        contextGuard: {
            excludedTags: ['private', 'sensitive'],
            excludedNotePaths: ['notes/private.md'],
            supportLevel: 'enforced',
            supportMessage: '1 tagged note hidden via generated Claude permissions.',
        },
    });

    assert.match(lines.join('\n'), /Context guard: enforced \(2 tags, 1 note\)/);
    assert.match(lines.join('\n'), /Context guard detail: 1 tagged note hidden via generated Claude permissions\./);
});

test('writeStartupBanner handles partial support with empty excluded notes', () => {
    const { lines, terminal } = createTerminal();

    writeStartupBanner(terminal as any, {
        command: 'gemini.exe',
        args: [],
        commandSource: 'PATH',
        vaultPath: 'C:\\vault',
        toolDisplayName: 'Gemini',
        debugLoggingEnabled: false,
        contextGuard: {
            excludedTags: ['private'],
            excludedNotePaths: [],
            supportLevel: 'partial',
            supportMessage: 'No tagged notes matched current vault metadata.',
        },
    });

    assert.match(lines.join('\n'), /Context guard: partial \(1 tag, 0 notes\)/);
    assert.match(lines.join('\n'), /Context guard detail: No tagged notes matched current vault metadata\./);
});

test('writeStartupBanner falls back to a disabled context guard summary when contextGuard is omitted', () => {
    const { lines, terminal } = createTerminal();

    writeStartupBanner(terminal as any, {
        command: 'codex.exe',
        args: ['--model', 'gpt-5'],
        commandSource: 'PATH',
        vaultPath: 'C:\\vault',
        toolDisplayName: 'Codex',
        debugLoggingEnabled: false,
    });

    assert.match(lines.join('\n'), /Context guard: none \(0 tags, 0 notes\)/);
    assert.match(lines.join('\n'), /Context guard detail: Global tag guard is off\./);
    assert.match(lines.join('\n'), /Args: hidden \(enable debug logging to display launch args\)/);
});

test('writeContextGuardStaleWarning explains that a restart is required', () => {
    const { lines, terminal } = createTerminal();

    writeContextGuardStaleWarning(terminal as any, 1, 2);

    assert.match(lines.join('\n'), /\[context guard changed\]/);
    assert.match(lines.join('\n'), /Excluded note set changed from 1 note to 2 notes\./);
    assert.match(lines.join('\n'), /Restart the Galdur session to apply updated exclusions\./);
});
