import { access } from 'fs/promises';
import { DEFAULT_EXEC_TIMEOUT_MS, EXTRACT_TIMEOUT_MS, RUNTIME_ARG_VERSION } from '../../constants';
import { execFileText } from '../../utils/process';

export async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

export async function probeRuntimeVersion(runtimePath: string): Promise<string | null> {
    try {
        const output = await execFileText(runtimePath, [RUNTIME_ARG_VERSION], {
            timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
        });
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
