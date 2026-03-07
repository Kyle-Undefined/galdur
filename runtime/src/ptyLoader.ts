import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';
import { NODE_MODULES_DIR } from 'src/constants';
import { PtyModule } from './types';

let ptyModule: PtyModule | null = null;

export function getPtyModule(): PtyModule {
    if (ptyModule) {
        return ptyModule;
    }

    const attempts: string[] = [];
    const candidates = getNodePtyCandidates();
    for (const candidate of candidates) {
        if (candidate === 'node-pty') {
            try {
                ptyModule = require('node-pty') as PtyModule;
                return ptyModule;
            } catch (error) {
                attempts.push(`node-pty: ${String(error)}`);
            }
            continue;
        }

        const packageJsonPath = path.join(candidate, 'package.json');
        if (!fs.existsSync(packageJsonPath)) {
            attempts.push(`${candidate}: package.json missing`);
            continue;
        }

        try {
            const candidateRequire = createRequire(packageJsonPath);
            ptyModule = candidateRequire('.') as PtyModule;
            return ptyModule;
        } catch (error) {
            attempts.push(`${candidate}: ${String(error)}`);
        }
    }

    throw new Error(
        [
            'Failed to load node-pty for runtime.',
            'Checked candidates:',
            ...attempts.map((attempt) => `- ${attempt}`),
        ].join('\n')
    );
}

function getNodePtyCandidates(): string[] {
    const values = new Set<string>();
    values.add('node-pty');

    if (typeof __dirname === 'string' && __dirname.length > 0) {
        values.add(path.join(__dirname, NODE_MODULES_DIR, 'node-pty'));
        values.add(path.join(__dirname, '..', NODE_MODULES_DIR, 'node-pty'));
    }

    if (process.argv[1]) {
        const argvDir = path.dirname(process.argv[1]);
        values.add(path.join(argvDir, NODE_MODULES_DIR, 'node-pty'));
    }

    if (process.execPath) {
        const exeDir = path.dirname(process.execPath);
        values.add(path.join(exeDir, NODE_MODULES_DIR, 'node-pty'));
    }

    values.add(path.join(process.cwd(), NODE_MODULES_DIR, 'node-pty'));

    return [...values];
}
