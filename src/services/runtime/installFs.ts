import { join } from 'path';
import { copyFile, rename, rm, unlink } from 'fs/promises';
import {
    NODE_MODULES_DIR,
    RM_MAX_RETRIES,
    RM_RETRY_DELAY_MS,
    RUNTIME_CHECKSUM_FILE,
    RUNTIME_VERSION_METADATA_FILE,
} from '../../constants';
import { pathExists } from './fileSystem';
import { Arch, Paths, Platform } from './Paths';
import { swallowError } from '../../utils/logging';

const MANAGED_RUNTIME_PLATFORMS: Platform[] = ['windows'];
const MANAGED_RUNTIME_ARCHES: Arch[] = ['x64', 'arm64'];

const RM_RETRY_OPTIONS = { maxRetries: RM_MAX_RETRIES, retryDelay: RM_RETRY_DELAY_MS } as const;

export async function atomicReplace(fromPath: string, toPath: string): Promise<void> {
    await withBackupSwap(toPath, {
        clearBackup: async (backupPath) => await rm(backupPath, { force: true, ...RM_RETRY_OPTIONS }).catch(() => undefined),
        replace: async () => {
            try {
                await rename(fromPath, toPath);
            } catch (renameError: unknown) {
                const isExdev =
                    renameError instanceof Error &&
                    'code' in renameError &&
                    (renameError as NodeJS.ErrnoException).code === 'EXDEV';
                if (isExdev) {
                    await copyFile(fromPath, toPath);
                    await unlink(fromPath).catch(() => undefined);
                    return;
                }
                throw renameError;
            }
        },
        deleteBackup: async (backupPath) => await rm(backupPath, { force: true, ...RM_RETRY_OPTIONS }).catch(() => undefined),
    });
}

export async function atomicReplaceDirectory(fromPath: string, toPath: string): Promise<void> {
    await withBackupSwap(toPath, {
        clearBackup: async (backupPath) =>
            await rm(backupPath, { recursive: true, force: true, ...RM_RETRY_OPTIONS }).catch(() => undefined),
        replace: async () => {
            await rename(fromPath, toPath);
        },
        deleteBackup: async (backupPath) =>
            await rm(backupPath, { recursive: true, force: true, ...RM_RETRY_OPTIONS }).catch(() => undefined),
    });
}

async function withBackupSwap(
    toPath: string,
    options: {
        clearBackup: (backupPath: string) => Promise<void>;
        replace: () => Promise<void>;
        deleteBackup: (backupPath: string) => Promise<void>;
    }
): Promise<void> {
    const backupPath = `${toPath}.bak`;
    const targetExists = await pathExists(toPath);

    if (targetExists) {
        await options.clearBackup(backupPath);
        await rename(toPath, backupPath);
    }

    try {
        await options.replace();
        if (targetExists) {
            await options.deleteBackup(backupPath);
        }
    } catch (error) {
        if (targetExists && (await pathExists(backupPath))) {
            await rename(backupPath, toPath).catch(() => undefined);
        }
        throw error;
    }
}

export async function removeManagedInstallDir(installDir: string, runtimePaths: Paths = new Paths()): Promise<void> {
    await rm(installDir, {
        recursive: true,
        force: true,
        ...RM_RETRY_OPTIONS,
    }).catch(swallowError);

    if (!(await pathExists(installDir))) {
        return;
    }

    const managedRuntimeFiles: string[] = [];
    for (const platform of MANAGED_RUNTIME_PLATFORMS) {
        for (const arch of MANAGED_RUNTIME_ARCHES) {
            managedRuntimeFiles.push(join(installDir, runtimePaths.getRuntimeAssetName(platform, arch)));
        }
    }
    managedRuntimeFiles.push(join(installDir, RUNTIME_CHECKSUM_FILE));
    managedRuntimeFiles.push(join(installDir, RUNTIME_VERSION_METADATA_FILE));
    for (const filePath of managedRuntimeFiles) {
        await rm(filePath, { force: true }).catch(swallowError);
    }

    const managedRuntimeNodeModules = join(installDir, NODE_MODULES_DIR);
    await rm(managedRuntimeNodeModules, {
        recursive: true,
        force: true,
        ...RM_RETRY_OPTIONS,
    }).catch(swallowError);

    await rm(installDir, {
        recursive: true,
        force: true,
        ...RM_RETRY_OPTIONS,
    }).catch(swallowError);
}
