import { access, mkdir, readdir } from 'fs/promises';
import extractZip from 'extract-zip';
import { RUNTIME_ARG_VERSION, RUNTIME_VERSION_PROBE_TIMEOUT_MS } from '../../constants';
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
    await mkdir(outputDir, { recursive: true });
    await extractZip(archivePath, { dir: outputDir });
}

export async function listDirectorySummary(path: string): Promise<string> {
    try {
        const entries = await readdir(path, { withFileTypes: true });
        if (entries.length === 0) {
            return '(empty)';
        }
        return entries
            .slice(0, 12)
            .map((entry) => `${entry.isDirectory() ? 'dir' : 'file'}:${entry.name}`)
            .join(', ');
    } catch (error) {
        return `(unreadable: ${String(error)})`;
    }
}
