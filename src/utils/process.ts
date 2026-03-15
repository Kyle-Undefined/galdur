import { execFile } from 'child_process';
import { COMMAND_LOOKUP_TIMEOUT_MS, DEFAULT_EXEC_TIMEOUT_MS } from '../constants';

export type ExecFileTextOptions = {
    timeoutMs?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
};

export async function execFileText(command: string, args: string[], options?: ExecFileTextOptions): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

    return await new Promise<string>((resolve, reject) => {
        const child = execFile(
            command,
            args,
            {
                encoding: 'utf8',
                windowsHide: true,
                cwd: options?.cwd,
                env: options?.env,
                maxBuffer: 1024 * 1024,
            },
            (error, stdout) => {
                clearTimeout(timeout);
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stdout ?? '');
            }
        );

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
        }, timeoutMs);
    });
}

export async function findWithWhere(executable: string): Promise<string[]> {
    if (process.platform !== 'win32') {
        throw new Error(`findWithWhere is only supported on Windows (current platform: ${process.platform})`);
    }
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

export async function commandExistsOnPath(command: string): Promise<boolean> {
    if (process.platform !== 'win32') {
        throw new Error(`commandExistsOnPath is only supported on Windows (current platform: ${process.platform})`);
    }
    return (await findWithWhere(command)).length > 0;
}
