import { COMMAND_LOOKUP_TIMEOUT_MS } from '../constants';
import { execFileText } from '../utils/process';

const WINDOWS_DRIVE_PATH_RE = /^([A-Za-z]):[\\/](.*)$/;
const WSL_FALLBACK_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

export function windowsPathToWsl(windowsPath: string): string {
    const match = WINDOWS_DRIVE_PATH_RE.exec(windowsPath);
    if (!match) {
        return windowsPath.replace(/\\/g, '/');
    }

    const driveLetter = match[1].toLowerCase();
    const remainder = match[2].replace(/\\/g, '/');
    return `/mnt/${driveLetter}/${remainder}`;
}

export function wrapCommandForWsl(
    command: string,
    args: string[],
    distro?: string,
    cwd?: string
): { command: string; args: string[] } {
    const wrappedArgs: string[] = [];
    if (distro?.trim()) {
        wrappedArgs.push('--distribution', distro.trim());
    }
    if (cwd?.trim()) {
        wrappedArgs.push('--cd', cwd.trim());
    }
    wrappedArgs.push('--', ...buildWslLaunchArgs(command, args));
    return {
        command: 'wsl.exe',
        args: wrappedArgs,
    };
}

export async function resolveExecutableInWsl(binary: string, distro?: string): Promise<string | null> {
    for (const args of getWslExecutableLookupArgs(binary)) {
        try {
            const output = await execFileText('wsl.exe', buildWslArgs(args, distro), {
                timeoutMs: COMMAND_LOOKUP_TIMEOUT_MS,
            });
            const resolved = parseResolvedExecutablePath(output);
            if (resolved) {
                return resolved;
            }
        } catch {
            continue;
        }
    }

    return null;
}

export async function pathExistsInWsl(path: string, distro?: string): Promise<boolean> {
    try {
        await execFileText('wsl.exe', buildWslArgs(['test', '-e', path], distro), {
            timeoutMs: COMMAND_LOOKUP_TIMEOUT_MS,
        });
        return true;
    } catch {
        return false;
    }
}

export async function isWslAvailable(): Promise<boolean> {
    try {
        await execFileText('wsl.exe', ['--status'], { timeoutMs: COMMAND_LOOKUP_TIMEOUT_MS });
        return true;
    } catch {
        return false;
    }
}

export async function listWslDistros(): Promise<string[]> {
    try {
        const output = await execFileText('wsl.exe', ['--list', '--quiet'], {
            timeoutMs: COMMAND_LOOKUP_TIMEOUT_MS,
        });
        return output
            .split(/\r?\n/)
            .map((line) => line.split('\0').join('').trim())
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
}

function buildWslArgs(args: string[], distro?: string): string[] {
    return distro?.trim() ? ['--distribution', distro.trim(), '--', ...args] : ['--', ...args];
}

export function getWslExecutableLookupArgs(binary: string): string[][] {
    return [
        [
            'sh',
            '-lc',
            `binary=${shellSingleQuote(binary)}; for dir in "$HOME/.local/bin" "$HOME/.bun/bin" "$HOME/.npm/bin"; do if [ -x "$dir/$binary" ]; then printf "%s\\n" "$dir/$binary"; exit 0; fi; done`,
        ],
        ['bash', '-ic', `command -v -- ${shellSingleQuote(binary)}`],
        ['bash', '-lc', `command -v -- ${shellSingleQuote(binary)}`],
    ];
}

export function parseResolvedExecutablePath(output: string): string | null {
    const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    for (const line of lines) {
        if (/^\/\S+$/.test(line) && !isMountedWindowsPath(line)) {
            return line;
        }
    }

    return null;
}

export function shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isMountedWindowsPath(path: string): boolean {
    return /^\/mnt\/[a-z]\//.test(path);
}

function buildWslLaunchArgs(command: string, args: string[]): string[] {
    if (!command.startsWith('/')) {
        return [command, ...args];
    }

    const commandDir = command.slice(0, Math.max(command.lastIndexOf('/'), 1));
    return ['env', `PATH=${commandDir}:${WSL_FALLBACK_PATH}`, command, ...args];
}
