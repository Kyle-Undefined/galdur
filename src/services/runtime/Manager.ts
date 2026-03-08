import { createHash, randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { PLUGIN_ID } from '../../constants';
import { GaldurSettings, RuntimeInstallStatus, VaultPaths } from '../../types';
import { Installer } from './Installer';
import { MetadataStore } from './MetadataStore';
import { Paths } from './Paths';
import { StatusService } from './StatusService';

function createAuthToken(): string {
    const nonce = randomUUID();
    return createHash('sha256').update(`${PLUGIN_ID}:runtime-auth:${nonce}`).digest('hex');
}

export class Manager {
    private readonly paths: Paths;
    private readonly metadata: MetadataStore;
    private readonly status: StatusService;
    private readonly installer: Installer;

    constructor(paths: Paths = new Paths(), metadata?: MetadataStore, status?: StatusService, installer?: Installer) {
        this.paths = paths;
        this.metadata = metadata ?? new MetadataStore(this.paths);
        this.status = status ?? new StatusService(this.paths, this.metadata);
        this.installer = installer ?? new Installer(this.paths, this.metadata);
    }

    public getRuntimeInstallDir(vaultPaths: VaultPaths): string {
        return this.paths.getRuntimeInstallDir(vaultPaths);
    }

    public getRuntimeLogsDir(vaultPaths: VaultPaths): string {
        return this.paths.getRuntimeLogsDir(vaultPaths);
    }

    public async ensureRuntimeLogsDir(vaultPaths: VaultPaths): Promise<string> {
        const logsDir = this.paths.getRuntimeLogsDir(vaultPaths);
        await mkdir(logsDir, { recursive: true });
        return logsDir;
    }

    public getResolvedRuntimePath(vaultPaths: VaultPaths, settings: GaldurSettings): string {
        return this.paths.getResolvedRuntimePath(vaultPaths, settings);
    }

    public async getInstallStatus(
        vaultPaths: VaultPaths,
        settings: GaldurSettings,
        pluginVersion: string
    ): Promise<RuntimeInstallStatus> {
        return await this.status.getInstallStatus(vaultPaths, settings, pluginVersion);
    }

    public async installRuntime(
        vaultPaths: VaultPaths,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        await this.ensureRuntimeLogsDir(vaultPaths);
        return await this.installer.installRuntime(vaultPaths, pluginVersion);
    }

    public async uninstallRuntime(vaultPaths: VaultPaths): Promise<void> {
        await this.installer.uninstallRuntime(vaultPaths);
    }

    public async hasLocalRuntimeSource(vaultPaths: VaultPaths): Promise<boolean> {
        return await this.installer.hasLocalRuntimeSource(vaultPaths);
    }

    public async installLocalBuiltRuntime(
        vaultPaths: VaultPaths,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        await this.ensureRuntimeLogsDir(vaultPaths);
        return await this.installer.installLocalBuiltRuntime(vaultPaths, pluginVersion);
    }

    public buildPipePath(): string {
        return this.paths.buildPipePath();
    }

    public createAuthToken(): string {
        return createAuthToken();
    }
}
