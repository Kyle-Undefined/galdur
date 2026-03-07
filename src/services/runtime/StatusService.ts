import { GaldurSettings, RuntimeInstallStatus } from '../../types';
import { tokenizeCommandLine } from '../../utils/cliArgs';
import { looksLikePath } from '../../utils/strings';
import { commandExistsOnPath } from '../../utils/process';
import { pathExists, probeRuntimeVersion } from './fileSystem';
import { MetadataStore } from './MetadataStore';
import { Paths } from './Paths';

export class StatusService {
    public constructor(
        private readonly paths: Paths,
        private readonly metadata: MetadataStore
    ) {}

    public async getInstallStatus(
        vaultPath: string,
        settings: GaldurSettings,
        pluginVersion: string
    ): Promise<RuntimeInstallStatus> {
        const runtimePath = this.paths.getResolvedRuntimePath(vaultPath, settings);
        const installDir = this.paths.getRuntimeInstallDir(vaultPath);
        const isCustomPath = (settings.runtimePath?.trim()?.length ?? 0) > 0;
        const targetVersion = pluginVersion;
        const supportError = this.paths.getSupportError();

        if (isCustomPath) {
            return await this.getCustomInstallStatus(runtimePath, installDir, targetVersion, settings.runtimeVersion);
        }

        if (supportError) {
            return {
                state: 'error',
                runtimePath,
                installDir,
                installedVersion: null,
                targetVersion,
                isCustomPath,
                message: supportError,
            };
        }

        const exists = await pathExists(runtimePath);
        if (!exists) {
            return {
                state: 'not-installed',
                runtimePath,
                installDir,
                installedVersion: null,
                targetVersion,
                isCustomPath,
                message: 'Runtime binary not found.',
            };
        }

        const installedVersion = await this.getInstalledRuntimeVersion(vaultPath, runtimePath);
        if (!installedVersion) {
            return {
                state: 'installed',
                runtimePath,
                installDir,
                installedVersion: null,
                targetVersion,
                isCustomPath,
                message: 'Runtime is present but version could not be determined.',
            };
        }

        if (installedVersion !== targetVersion) {
            return {
                state: 'outdated',
                runtimePath,
                installDir,
                installedVersion,
                targetVersion,
                isCustomPath,
                message: `Runtime version ${installedVersion} is different from plugin version ${targetVersion}.`,
            };
        }

        return {
            state: 'installed',
            runtimePath,
            installDir,
            installedVersion,
            targetVersion,
            isCustomPath,
            message: 'Runtime is installed.',
        };
    }

    private async getCustomInstallStatus(
        runtimePath: string,
        installDir: string,
        targetVersion: string,
        configuredVersion: string | null
    ): Promise<RuntimeInstallStatus> {
        const tokens = tokenizeCommandLine(runtimePath);
        if (tokens.length === 0) {
            return {
                state: 'error',
                runtimePath,
                installDir,
                installedVersion: configuredVersion,
                targetVersion,
                isCustomPath: true,
                message: 'Custom runtime path is empty.',
            };
        }

        const command = tokens[0];
        if (looksLikePath(command) && !(await pathExists(command))) {
            return {
                state: 'error',
                runtimePath,
                installDir,
                installedVersion: configuredVersion,
                targetVersion,
                isCustomPath: true,
                message: `Custom runtime command not found: ${command}`,
            };
        }
        if (!looksLikePath(command) && !(await commandExistsOnPath(command))) {
            return {
                state: 'error',
                runtimePath,
                installDir,
                installedVersion: configuredVersion,
                targetVersion,
                isCustomPath: true,
                message: `Custom runtime command not found on PATH: ${command}`,
            };
        }

        if (tokens.length > 1) {
            const possibleScript = tokens[1];
            if (looksLikePath(possibleScript) && !(await pathExists(possibleScript))) {
                return {
                    state: 'error',
                    runtimePath,
                    installDir,
                    installedVersion: configuredVersion,
                    targetVersion,
                    isCustomPath: true,
                    message: `Custom runtime script not found: ${possibleScript}`,
                };
            }
        }

        return {
            state: 'installed',
            runtimePath,
            installDir,
            installedVersion: configuredVersion,
            targetVersion,
            isCustomPath: true,
            message: 'Using custom runtime command override.',
        };
    }

    private async getInstalledRuntimeVersion(vaultPath: string, runtimePath: string): Promise<string | null> {
        const probedVersion = await probeRuntimeVersion(runtimePath);
        if (probedVersion) {
            return probedVersion;
        }

        const parsed = await this.metadata.read(vaultPath);
        if (parsed && parsed.runtimePath === runtimePath && typeof parsed.version === 'string') {
            return parsed.version;
        }

        return null;
    }
}
