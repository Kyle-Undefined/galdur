import { randomUUID } from 'crypto';
import { mkdir, rm, unlink } from 'fs/promises';
import { dirname, join } from 'path';
import {
    OBSIDIAN_DIR,
    PLUGINS_DIR,
    PLUGIN_ID,
    RUNTIME_CHECKSUM_FILE,
    RUNTIME_DIR,
    RUNTIME_DIST_DIR,
    RUNTIME_RELEASE_BASE_URL,
} from '../../constants';
import { extractZipArchive, pathExists, probeRuntimeVersion } from './fileSystem';
import { atomicReplaceDirectory, removeManagedInstallDir } from './installFs';
import { MetadataStore, VersionMetadata } from './MetadataStore';
import { Paths } from './Paths';
import { DownloadService } from './DownloadService';

export class Installer {
    private readonly downloadService: DownloadService;

    public constructor(
        private readonly paths: Paths,
        private readonly metadata: MetadataStore,
        downloadService?: DownloadService
    ) {
        this.downloadService = downloadService ?? new DownloadService();
    }

    public async installRuntime(
        vaultPath: string,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        const target = this.paths.getTarget();
        const installDir = this.paths.getRuntimeInstallDir(vaultPath);
        const runtimeAsset = this.paths.getRuntimeAssetName(target.platform, target.arch);
        const runtimeBundle = this.paths.getRuntimeBundleName(target.platform, target.arch);
        const runtimePath = join(installDir, runtimeAsset);
        const installParentDir = dirname(installDir);
        const archivePath = join(installParentDir, `${runtimeBundle}.download-${randomUUID()}`);

        await mkdir(installParentDir, { recursive: true });

        const releaseTag = this.toReleaseTag(pluginVersion);
        const checksumsUrl = `${RUNTIME_RELEASE_BASE_URL}/${releaseTag}/${RUNTIME_CHECKSUM_FILE}`;
        const runtimeUrl = `${RUNTIME_RELEASE_BASE_URL}/${releaseTag}/${runtimeBundle}`;

        try {
            const checksums = await this.downloadService.downloadText(checksumsUrl);
            const expectedHash = this.downloadService.extractChecksum(checksums, runtimeBundle);
            if (!expectedHash) {
                throw new Error(`Checksum entry for ${runtimeBundle} not found in ${RUNTIME_CHECKSUM_FILE}.`);
            }

            await this.downloadService.downloadFile(runtimeUrl, archivePath);
            const actualHash = await this.downloadService.sha256File(archivePath);
            if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
                throw new Error(
                    `Runtime checksum mismatch for ${runtimeBundle}. expected=${expectedHash} actual=${actualHash}`
                );
            }

            return await this.installRuntimeBundle({
                vaultPath,
                pluginVersion,
                installDir,
                runtimeAsset,
                bundlePath: archivePath,
                runtimePath,
                createMetadata: (runtimeVersion) => ({
                    version: runtimeVersion,
                    installedAt: new Date().toISOString(),
                    runtimePath,
                }),
                buildVersionMismatchMessage: (runtimeVersion) =>
                    `Installed runtime version mismatch. Expected ${pluginVersion}, got ${runtimeVersion ?? 'unknown'}.`,
            });
        } finally {
            await unlink(archivePath).catch(() => undefined);
        }
    }

    public async uninstallRuntime(vaultPath: string): Promise<void> {
        const installDir = this.paths.getRuntimeInstallDir(vaultPath);
        if (!(await pathExists(installDir))) {
            return;
        }

        await removeManagedInstallDir(installDir, this.paths);
        if (await pathExists(installDir)) {
            throw new Error(
                `Could not fully remove managed runtime directory: ${installDir}. Files may still be locked by another process.`
            );
        }
    }

    public async hasLocalRuntimeSource(vaultPath: string): Promise<boolean> {
        return (await this.tryResolveLocalBuiltRuntimeBundle(vaultPath)) !== null;
    }

    public async installLocalBuiltRuntime(
        vaultPath: string,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        const installDir = this.paths.getRuntimeInstallDir(vaultPath);
        const built = await this.resolveLocalBuiltRuntimeBundle(vaultPath);
        const targetExePath = join(installDir, built.runtimeAsset);

        return await this.installRuntimeBundle({
            vaultPath,
            pluginVersion,
            installDir,
            runtimeAsset: built.runtimeAsset,
            bundlePath: built.bundlePath,
            runtimePath: targetExePath,
            createMetadata: (runtimeVersion) => ({
                version: runtimeVersion,
                installedAt: new Date().toISOString(),
                runtimePath: targetExePath,
                sourcePath: built.bundlePath,
                localDevExe: true,
            }),
            buildVersionMismatchMessage: (runtimeVersion) =>
                `Local runtime version mismatch. Expected ${pluginVersion}, got ${runtimeVersion ?? 'unknown'}. Rebuild runtime/dist from this repo version before installing.`,
        });
    }

    private toReleaseTag(version: string): string {
        return version.startsWith('v') ? version : `v${version}`;
    }

    private async resolveLocalBuiltRuntimeBundle(
        vaultPath: string
    ): Promise<{ bundlePath: string; runtimeAsset: string }> {
        const resolved = await this.tryResolveLocalBuiltRuntimeBundle(vaultPath);
        if (resolved) {
            return resolved;
        }

        throw new Error(
            'Could not find local built runtime bundle under vault plugin runtime/dist. Build in repo, then copy runtime/dist into VAULT/.obsidian/plugins/galdur/runtime/dist.'
        );
    }

    private async tryResolveLocalBuiltRuntimeBundle(
        vaultPath: string
    ): Promise<{ bundlePath: string; runtimeAsset: string } | null> {
        const pluginDir = join(vaultPath, OBSIDIAN_DIR, PLUGINS_DIR, PLUGIN_ID);
        const archCandidates = this.paths.getLocalArchCandidates();
        const distCandidates = [join(pluginDir, RUNTIME_DIR, RUNTIME_DIST_DIR)];
        const { platform } = this.paths.getTarget();

        for (const distDir of distCandidates) {
            for (const arch of archCandidates) {
                const bundleName = this.paths.getRuntimeBundleName(platform, arch);
                const bundlePath = join(distDir, bundleName);
                if (await pathExists(bundlePath)) {
                    return {
                        bundlePath,
                        runtimeAsset: this.paths.getRuntimeAssetName(platform, arch),
                    };
                }
            }
        }

        return null;
    }

    private async installRuntimeBundle(params: {
        vaultPath: string;
        pluginVersion: string;
        installDir: string;
        runtimeAsset: string;
        bundlePath: string;
        runtimePath: string;
        createMetadata: (runtimeVersion: string) => VersionMetadata;
        buildVersionMismatchMessage: (runtimeVersion: string | null) => string;
    }): Promise<{ runtimePath: string; version: string }> {
        const stageDir = `${params.installDir}.stage-${randomUUID()}`;

        await mkdir(dirname(params.installDir), { recursive: true });

        try {
            await rm(stageDir, { recursive: true, force: true });
            await extractZipArchive(params.bundlePath, stageDir);

            const runtimeVersion = await this.validateStagedRuntimeVersion(
                stageDir,
                params.runtimeAsset,
                params.pluginVersion,
                params.buildVersionMismatchMessage
            );

            await atomicReplaceDirectory(stageDir, params.installDir);
            await this.metadata.write(params.vaultPath, params.createMetadata(runtimeVersion));

            return {
                runtimePath: params.runtimePath,
                version: runtimeVersion,
            };
        } finally {
            await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    private async validateStagedRuntimeVersion(
        stageDir: string,
        runtimeAsset: string,
        expectedVersion: string,
        buildVersionMismatchMessage: (runtimeVersion: string | null) => string
    ): Promise<string> {
        const stagedRuntimePath = join(stageDir, runtimeAsset);
        const runtimeVersion = await probeRuntimeVersion(stagedRuntimePath);

        if (runtimeVersion !== expectedVersion) {
            throw new Error(buildVersionMismatchMessage(runtimeVersion));
        }

        return runtimeVersion;
    }
}
