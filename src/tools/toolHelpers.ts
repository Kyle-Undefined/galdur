import { win32 } from 'path';
import { tokenizeArgLine } from '../utils/cliArgs';

export type CommonPathPattern = { envVar: string; subPath: string; names: readonly string[] };

export function makeCommonPaths(binaryCmd: string, binaryExe: string): CommonPathPattern[] {
    return [
        { envVar: 'APPDATA', subPath: 'npm', names: [binaryCmd, binaryExe] },
        { envVar: 'USERPROFILE', subPath: '.local/bin', names: [binaryExe, binaryCmd] },
        { envVar: 'USERPROFILE', subPath: '.bun/bin', names: [binaryExe, binaryCmd] },
        { envVar: 'LOCALAPPDATA', subPath: 'pnpm', names: [binaryCmd, binaryExe] },
    ];
}

export function expandCommonPaths(patterns: readonly CommonPathPattern[]): string[] {
    const candidates: string[] = [];
    for (const { envVar, subPath, names } of patterns) {
        const base = process.env[envVar];
        if (!base) {
            continue;
        }
        // These candidates target Windows-hosted CLIs discovered from Windows env vars.
        for (const name of names) {
            candidates.push(win32.join(base, subPath, name));
        }
    }
    return candidates;
}

export function parseExtraArgs(raw: string): string[] {
    const tokens: string[] = [];
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        tokens.push(...tokenizeArgLine(line));
    }
    return tokens;
}

export function formatArgsForDisplay(args: readonly string[]): string {
    if (args.length === 0) {
        return '(none)';
    }

    return args
        .map((arg) => {
            if (arg.length === 0 || /[\s"]/.test(arg)) {
                return JSON.stringify(arg);
            }
            return arg;
        })
        .join(' ');
}
