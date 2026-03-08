import { randomUUID } from 'crypto';
import { join } from 'path';
import { RUNTIME_VERSION_METADATA_FILE } from '../../constants';
import { GaldurSettings, VaultPaths } from '../../types';

export type Platform = 'windows';
export type Arch = 'x64' | 'arm64';

export class Paths {
    public getRuntimeInstallDir(vaultPaths: VaultPaths): string {
        return join(vaultPaths.pluginDir, 'bin');
    }

    public getRuntimeLogsDir(vaultPaths: VaultPaths): string {
        return join(vaultPaths.pluginDir, 'logs');
    }

    public getResolvedRuntimePath(vaultPaths: VaultPaths, settings: GaldurSettings): string {
        const custom = settings.runtimePath?.trim() ?? '';
        if (custom.length > 0) {
            return custom;
        }
        return join(this.getRuntimeInstallDir(vaultPaths), this.getDefaultRuntimeAssetName());
    }

    public buildPipePath(): string {
        const pipeName = `galdur-runtime-${process.pid}-${randomUUID()}`;
        return `\\\\.\\pipe\\${pipeName}`;
    }

    public getRuntimeAssetName(platform: Platform, arch: Arch): string {
        return `galdur-runtime-${platform}-${arch}.exe`;
    }

    public getRuntimeBundleName(platform: Platform, arch: Arch): string {
        return `galdur-runtime-${platform}-${arch}.zip`;
    }

    public getDefaultRuntimeAssetName(): string {
        const { platform, arch } = this.getTarget();
        return this.getRuntimeAssetName(platform, arch);
    }

    public getVersionMetadataPath(vaultPaths: VaultPaths): string {
        return join(this.getRuntimeInstallDir(vaultPaths), RUNTIME_VERSION_METADATA_FILE);
    }

    public getTarget(): { platform: Platform; arch: Arch } {
        if (process.platform !== 'win32') {
            throw new Error(`Managed runtime is currently Windows-only. Current platform: ${process.platform}.`);
        }

        if (process.arch === 'x64' || process.arch === 'arm64') {
            return { platform: 'windows', arch: process.arch };
        }

        throw new Error(
            `Managed runtime is currently available for win32 x64/arm64 only. Current architecture: ${process.arch}.`
        );
    }

    public getSupportError(): string | null {
        try {
            this.getTarget();
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    public getLocalArchCandidates(): Arch[] {
        if (process.arch === 'arm64') {
            return ['arm64', 'x64'];
        }
        return ['x64'];
    }
}
