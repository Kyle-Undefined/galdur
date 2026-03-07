import esbuild from 'esbuild';
import builtins from 'builtin-modules';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const rootDir = join(scriptDir, '..');
const entry = join(rootDir, 'runtime', 'src', 'index.ts');
const outfile = join(rootDir, 'runtime', 'galdur-runtime.js');

void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

async function main(): Promise<void> {
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node18',
        outfile,
        external: ['node-pty', ...builtins],
        sourcemap: false,
        logLevel: 'info',
        legalComments: 'none',
        banner: {
            js: '#!/usr/bin/env node',
        },
    });
}
