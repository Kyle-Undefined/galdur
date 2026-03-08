import { access } from 'fs/promises';
import { EXTRACT_TIMEOUT_MS, RUNTIME_ARG_VERSION, RUNTIME_VERSION_PROBE_TIMEOUT_MS } from '../../constants';
import { execFileText } from '../../utils/process';

export async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export async function probeRuntimeVersion(
    runtimePath: string,
    timeoutMs = RUNTIME_VERSION_PROBE_TIMEOUT_MS
): Promise<string | null> {
    return probeRuntimeCommandVersion(runtimePath, [], timeoutMs);
}

export async function probeRuntimeCommandVersion(
    command: string,
    args: readonly string[] = [],
    timeoutMs = RUNTIME_VERSION_PROBE_TIMEOUT_MS
): Promise<string | null> {
    try {
        const output = await execFileText(command, [...args, RUNTIME_ARG_VERSION], { timeoutMs });
        const version = output.trim();
        return version.length > 0 ? version : null;
    } catch {
        return null;
    }
}

export async function extractZipArchive(archivePath: string, outputDir: string): Promise<void> {
    await execFileText(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& { param($ArchivePath, $OutputDir) Expand-Archive -LiteralPath $ArchivePath -DestinationPath $OutputDir -Force }',
            archivePath,
            outputDir,
        ],
        {
            timeoutMs: EXTRACT_TIMEOUT_MS,
        }
    );
}
