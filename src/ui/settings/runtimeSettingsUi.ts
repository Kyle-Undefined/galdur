import { Setting } from 'obsidian';
import { RuntimeInstallStatus } from '../../types';

export type RuntimeAction = 'install' | 'update' | 'reinstall' | 'uninstall' | 'installLocalExe';
export const INSTALL_LIKE_RUNTIME_ACTIONS: RuntimeAction[] = ['install', 'update', 'reinstall'];

export const RUNTIME_ACTION_LABELS: Record<RuntimeAction, { pastTense: string; busyLabel: string }> = {
    install: { pastTense: 'installed', busyLabel: 'Installing runtime' },
    update: { pastTense: 'updated', busyLabel: 'Updating runtime' },
    reinstall: { pastTense: 'reinstalled', busyLabel: 'Reinstalling runtime' },
    uninstall: { pastTense: 'uninstalled', busyLabel: 'Uninstalling runtime' },
    installLocalExe: {
        pastTense: 'installed (local dev runtime)',
        busyLabel: 'Installing local dev runtime',
    },
};

export function addActionButton(
    setting: Setting,
    label: string,
    action: RuntimeAction,
    onClick: (action: RuntimeAction) => Promise<void>,
    options?: { cta?: boolean; warning?: boolean }
): void {
    setting.addButton((button) => {
        button.setButtonText(label).onClick(async () => {
            button.setDisabled(true);
            try {
                await onClick(action);
            } finally {
                button.setDisabled(false);
            }
        });
        if (options?.cta) {
            button.setCta();
        }
        if (options?.warning) {
            button.setWarning();
        }
    });
}

export function buildRuntimeStatusDescription(status: RuntimeInstallStatus): DocumentFragment {
    const parts = [
        `State: ${status.state}`,
        `Path: ${status.runtimePath}`,
        `Target version: ${status.targetVersion}`,
        `Installed version: ${status.installedVersion ?? 'unknown'}`,
    ];
    if (status.message) {
        parts.push(`Detail: ${status.message}`);
    }

    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
        if (i > 0) {
            frag.appendChild(document.createElement('br'));
        }
        frag.appendChild(document.createTextNode(part));
    });
    return frag;
}

export async function openPathInElectron(path: string): Promise<void> {
    let openPathResult = '';
    try {
        const electron = require('electron') as {
            shell?: { openPath: (value: string) => Promise<string> };
        };
        if (!electron.shell) {
            throw new Error('Electron shell is unavailable.');
        }
        openPathResult = await electron.shell.openPath(path);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not open path: ${path}. ${message}`);
    }

    if (openPathResult) {
        throw new Error(`Could not open path: ${path}. ${openPathResult}`);
    }
}
