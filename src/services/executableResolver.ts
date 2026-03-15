import { access } from 'fs/promises';
import { CommandResolution, ToolExecutionContext } from '../types';
import { getWslExecutableLookupArgs, pathExistsInWsl, resolveExecutableInWsl, shellSingleQuote } from './wsl';
import { looksLikePath, stripOuterQuotes } from '../utils/strings';
import { findWithWhere } from '../utils/process';

export type ExecutableResolverOptions = {
    overrideEnvVar: string;
    pathCandidates: string[];
    commonPathCandidates: string[];
    fallbackCommand: string;
};

const SHELL_DISPLAY_METACHAR_RE = /[\s"'$`!*,?[\](){}<>|&;\\]/;

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

export function resolveCommandWithContext(
    options: ExecutableResolverOptions,
    context?: ToolExecutionContext
): Promise<CommandResolution> {
    return context?.wslEnabled
        ? resolveExecutableWsl(options, context.wslDistro || undefined)
        : resolveExecutable(options);
}

async function resolveExecutableWsl(options: ExecutableResolverOptions, distro?: string): Promise<CommandResolution> {
    const attempts: string[] = [];

    const override = process.env[options.overrideEnvVar]?.trim();
    if (override) {
        const normalized = stripOuterQuotes(override);
        attempts.push(`${options.overrideEnvVar}=${normalized}`);
        if (!looksLikePath(normalized)) {
            return {
                command: normalized,
                source: `env:${options.overrideEnvVar}`,
                attempts,
                found: true,
            };
        }
        if (normalized.startsWith('/') && (await pathExistsInWsl(normalized, distro))) {
            return {
                command: normalized,
                source: `env:${options.overrideEnvVar}`,
                attempts,
                found: true,
            };
        }
        if (normalized.startsWith('/')) {
            attempts.push(`env override path not found in WSL: ${normalized}`);
        } else {
            attempts.push(`env override unusable in WSL (Windows-style path): ${normalized}`);
        }
    }

    for (const candidate of uniqueWslCandidates(options)) {
        attempts.push(
            ...getWslExecutableLookupArgs(candidate).map((lookupArgs) =>
                `wsl.exe ${formatDistroForAttempt(distro)}${formatWslAttemptArgs(lookupArgs)}`.trim()
            )
        );
        const result = await resolveExecutableInWsl(candidate, distro);
        if (result) {
            return {
                command: result,
                source: 'PATH',
                attempts,
                found: true,
            };
        }
    }

    return {
        command: stripExecutableSuffix(options.fallbackCommand),
        source: 'fallback',
        attempts,
        found: false,
    };
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function uniqueWslCandidates(options: ExecutableResolverOptions): string[] {
    const seen = new Set<string>();
    const candidates = [...options.pathCandidates, ...options.commonPathCandidates, options.fallbackCommand];

    return candidates
        .map(stripExecutableSuffix)
        .filter((candidate) => candidate.length > 0)
        .filter((candidate) => {
            if (candidate.includes('\\') || /^[A-Za-z]:/.test(candidate)) {
                return false;
            }
            if (seen.has(candidate)) {
                return false;
            }
            seen.add(candidate);
            return true;
        });
}

function stripExecutableSuffix(value: string): string {
    return value.replace(/\.(?:exe|cmd)$/i, '');
}

function formatDistroForAttempt(distro?: string): string {
    const trimmed = distro?.trim();
    return trimmed ? `--distribution ${quoteAttemptArgForDisplay(trimmed)} -- ` : '-- ';
}

function formatWslAttemptArgs(args: string[]): string {
    return args.map(quoteAttemptArgForDisplay).join(' ');
}

function quoteAttemptArgForDisplay(value: string): string {
    return SHELL_DISPLAY_METACHAR_RE.test(value) ? shellSingleQuote(value) : value;
}
