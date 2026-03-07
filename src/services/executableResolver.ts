import { access } from 'fs/promises';
import { COMMAND_LOOKUP_TIMEOUT_MS } from '../constants';
import { CommandResolution } from '../types';
import { looksLikePath, stripOuterQuotes } from '../utils/strings';
import { execFileText } from '../utils/process';

export type ExecutableResolverOptions = {
    overrideEnvVar: string;
    pathCandidates: string[];
    commonPathCandidates: string[];
    fallbackCommand: string;
};

export async function resolveExecutable(options: ExecutableResolverOptions): Promise<CommandResolution> {
    const attempts: string[] = [];

    const override = process.env[options.overrideEnvVar]?.trim();
    if (override) {
        const normalized = stripOuterQuotes(override);
        attempts.push(`${options.overrideEnvVar}=${normalized}`);
        if (!looksLikePath(normalized) || (await fileExists(normalized))) {
            return {
                command: normalized,
                source: `env:${options.overrideEnvVar}`,
                attempts,
                found: true,
            };
        }
    }

    if (process.platform === 'win32') {
        for (const candidate of options.pathCandidates) {
            attempts.push(`where.exe ${candidate}`);
            const result = await findWithWhere(candidate);
            if (result.length > 0) {
                return {
                    command: result[0],
                    source: 'PATH',
                    attempts,
                    found: true,
                };
            }
        }
    }

    for (const candidate of options.commonPathCandidates) {
        attempts.push(candidate);
        if (await fileExists(candidate)) {
            return {
                command: candidate,
                source: 'common-path',
                attempts,
                found: true,
            };
        }
    }

    return {
        command: options.fallbackCommand,
        source: 'fallback',
        attempts,
        found: false,
    };
}

async function findWithWhere(executable: string): Promise<string[]> {
    try {
        const output = await execFileText('where.exe', [executable], {
            timeoutMs: COMMAND_LOOKUP_TIMEOUT_MS,
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}
