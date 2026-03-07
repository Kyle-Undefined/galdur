import { createHash, randomUUID } from 'crypto';
import { mkdir } from 'fs/promises';
import { PLUGIN_ID } from '../../constants';
import { GaldurSettings, RuntimeInstallStatus } from '../../types';
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

    public getRuntimeInstallDir(vaultPath: string): string {
        return this.paths.getRuntimeInstallDir(vaultPath);
    }

    public getRuntimeLogsDir(vaultPath: string): string {
        return this.paths.getRuntimeLogsDir(vaultPath);
    }

    public async ensureRuntimeLogsDir(vaultPath: string): Promise<string> {
        const logsDir = this.paths.getRuntimeLogsDir(vaultPath);
        await mkdir(logsDir, { recursive: true });
        return logsDir;
    }

    public getResolvedRuntimePath(vaultPath: string, settings: GaldurSettings): string {
        return this.paths.getResolvedRuntimePath(vaultPath, settings);
    }

    public async getInstallStatus(
        vaultPath: string,
        settings: GaldurSettings,
        pluginVersion: string
    ): Promise<RuntimeInstallStatus> {
        return await this.status.getInstallStatus(vaultPath, settings, pluginVersion);
    }

    public async installRuntime(
        vaultPath: string,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        await this.ensureRuntimeLogsDir(vaultPath);
        return await this.installer.installRuntime(vaultPath, pluginVersion);
    }

    public async uninstallRuntime(vaultPath: string): Promise<void> {
        await this.installer.uninstallRuntime(vaultPath);
    }

    public async hasLocalRuntimeSource(vaultPath: string): Promise<boolean> {
        return await this.installer.hasLocalRuntimeSource(vaultPath);
    }

    public async installLocalBuiltRuntime(
        vaultPath: string,
        pluginVersion: string
    ): Promise<{ runtimePath: string; version: string }> {
        await this.ensureRuntimeLogsDir(vaultPath);
        return await this.installer.installLocalBuiltRuntime(vaultPath, pluginVersion);
    }

    public buildPipePath(): string {
        return this.paths.buildPipePath();
    }

    public createAuthToken(): string {
        return createAuthToken();
    }
}
