import { readFile, writeFile, rename, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';
import { pathExists } from './fileSystem';
import { Paths } from './Paths';

export type VersionMetadata = {
    version?: string;
    installedAt?: string;
    runtimePath?: string;
    sourcePath?: string;
    localDevExe?: boolean;
};

export class MetadataStore {
    public constructor(private readonly paths: Paths) {}

    public async read(vaultPath: string): Promise<VersionMetadata | null> {
        const metadataPath = this.paths.getVersionMetadataPath(vaultPath);
        if (!(await pathExists(metadataPath))) {
            return null;
        }

        try {
            const raw = await readFile(metadataPath, 'utf8');
            return parseVersionMetadata(JSON.parse(raw));
        } catch {
            return null;
        }
    }

    public async write(vaultPath: string, metadata: VersionMetadata): Promise<void> {
        const metadataPath = this.paths.getVersionMetadataPath(vaultPath);
        const tempPath = `${metadataPath}.${randomUUID()}.tmp`;
        await writeFile(tempPath, JSON.stringify(metadata, null, 2), 'utf8');
        try {
            await rename(tempPath, metadataPath);
        } catch (err) {
            await unlink(tempPath).catch(() => {});
            throw err;
        }
    }
}

function parseVersionMetadata(value: unknown): VersionMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const record = value as Record<string, unknown>;
    if (record.version !== undefined && typeof record.version !== 'string') {
        return null;
    }
    if (record.installedAt !== undefined && typeof record.installedAt !== 'string') {
        return null;
    }
    if (record.runtimePath !== undefined && typeof record.runtimePath !== 'string') {
        return null;
    }
    if (record.sourcePath !== undefined && typeof record.sourcePath !== 'string') {
        return null;
    }
    if (record.localDevExe !== undefined && typeof record.localDevExe !== 'boolean') {
        return null;
    }

    return {
        version: record.version as string | undefined,
        installedAt: record.installedAt as string | undefined,
        runtimePath: record.runtimePath as string | undefined,
        sourcePath: record.sourcePath as string | undefined,
        localDevExe: record.localDevExe as boolean | undefined,
    };
}
