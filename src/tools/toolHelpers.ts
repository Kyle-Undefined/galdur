import { join } from 'path';
import { tokenizeArgLine } from '../utils/cliArgs';

export type CommonPathPattern = { envVar: string; subPath: string; names: readonly string[] };

export function expandCommonPaths(patterns: readonly CommonPathPattern[]): string[] {
    const candidates: string[] = [];
    for (const { envVar, subPath, names } of patterns) {
        const base = process.env[envVar];
        if (!base) {
            continue;
        }
        for (const name of names) {
            candidates.push(join(base, subPath, name));
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
