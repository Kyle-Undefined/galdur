import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeArgLine, tokenizeCommandLine } from '../../src/utils/cliArgs';
import { looksLikePath, stripOuterQuotes } from '../../src/utils/strings';
import { expandCommonPaths, parseExtraArgs } from '../../src/tools/toolHelpers';

test('tokenizeCommandLine splits whitespace and preserves quoted segments', () => {
    const tokens = tokenizeCommandLine(`claude --model "sonnet 4" 'keep changes small'`);

    assert.deepEqual(tokens, ['claude', '--model', 'sonnet 4', 'keep changes small']);
});

test('tokenizeArgLine supports escapes outside single quotes', () => {
    const tokens = tokenizeArgLine(`one\\ two "three\\ four" 'five\\six'`);

    assert.deepEqual(tokens, ['one two', 'three four', 'five\\six']);
});

test('tokenizeArgLine preserves a trailing backslash when escape is unfinished', () => {
    const tokens = tokenizeArgLine('alpha\\');

    assert.deepEqual(tokens, ['alpha\\']);
});

test('stripOuterQuotes removes matching outer quotes only', () => {
    assert.equal(stripOuterQuotes('"quoted"'), 'quoted');
    assert.equal(stripOuterQuotes("'quoted'"), 'quoted');
    assert.equal(stripOuterQuotes('"mismatch\''), '"mismatch\'');
});

test('looksLikePath distinguishes commands from path-like values', () => {
    assert.equal(looksLikePath('codex'), false);
    assert.equal(looksLikePath('./codex'), true);
    assert.equal(looksLikePath('C:\\Tools\\codex.exe'), true);
});

test('parseExtraArgs ignores blank lines and combines tokens from multiple lines', () => {
    const parsed = parseExtraArgs(`
        --model gpt-5

        --search
        --prompt "keep changes small"
    `);

    assert.deepEqual(parsed, ['--model', 'gpt-5', '--search', '--prompt', 'keep changes small']);
});

test('expandCommonPaths skips unset env vars and expands candidate names in order', () => {
    const original = process.env.GALDUR_TEST_BASE;
    process.env.GALDUR_TEST_BASE = 'C:\\Users\\tester';

    try {
        const paths = expandCommonPaths([
            {
                envVar: 'GALDUR_TEST_BASE',
                subPath: 'bin',
                names: ['first.exe', 'second.exe'],
            },
            {
                envVar: 'GALDUR_TEST_MISSING',
                subPath: 'bin',
                names: ['ignored.exe'],
            },
        ]);

        assert.deepEqual(paths, ['C:\\Users\\tester\\bin\\first.exe', 'C:\\Users\\tester\\bin\\second.exe']);
    } finally {
        if (original === undefined) {
            delete process.env.GALDUR_TEST_BASE;
        } else {
            process.env.GALDUR_TEST_BASE = original;
        }
    }
});
