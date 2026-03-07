import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { cp, copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import arg from 'arg';
import esbuild from 'esbuild';
import builtins from 'builtin-modules';

type RuntimeArch = 'x64' | 'arm64';
type RuntimeArchArg = RuntimeArch | 'all';
type ScriptArgs = {
    arch: RuntimeArchArg;
};

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const rootDir = join(scriptDir, '..');
const require = createRequire(import.meta.url);
void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

async function main(): Promise<void> {
    await buildRuntimeJs(rootDir);

    const args = parseArgs(process.argv.slice(2));
    const archTargets = resolveArchTargets(args.arch);
    const nodeTarget = 'node18';
    const runtimeEntry = join(rootDir, 'runtime', 'galdur-runtime.js');
    const outDir = join(rootDir, 'runtime', 'dist');

    if (!existsSync(runtimeEntry)) {
        throw new Error(`Runtime entry not found: ${runtimeEntry}`);
    }

    const runtimeVersion = await readPluginVersion(rootDir);
    const versionedRuntimeEntry = await buildVersionedRuntimeEntry(runtimeEntry, outDir, runtimeVersion);

    await mkdir(outDir, { recursive: true });

    try {
        await rm(join(outDir, 'node_modules'), { recursive: true, force: true });

        const checksums: string[] = [];
        for (const arch of archTargets) {
            const exeName = `galdur-runtime-windows-${arch}.exe`;
            const exePath = join(outDir, exeName);
            const bundleName = `galdur-runtime-windows-${arch}.zip`;
            const bundlePath = join(outDir, bundleName);
            await rm(exePath, { force: true });
            await rm(bundlePath, { force: true });

            runPkgBuild(versionedRuntimeEntry, exePath, arch, nodeTarget, rootDir);
            await createRuntimeBundle(rootDir, outDir, exeName, bundlePath);
            await rm(exePath, { force: true });

            const hash = await hashFile(bundlePath);
            checksums.push(`${hash}  ${bundleName}`);

            console.log(`[galdur-runtime] bundled ${bundlePath}`);
        }

        const checksumsPath = join(outDir, 'galdur-runtime-checksums.txt');
        await writeFile(checksumsPath, `${checksums.join('\n')}\n`, 'utf8');

        console.log(`[galdur-runtime] wrote checksums ${checksumsPath}`);
    } finally {
        await rm(versionedRuntimeEntry, { force: true }).catch(() => undefined);
        await rm(join(outDir, '.tmp'), { recursive: true, force: true }).catch(() => undefined);
        await rm(join(outDir, 'node_modules'), { recursive: true, force: true }).catch(() => undefined);
    }
}

function parseArgs(argv: string[]): ScriptArgs {
    const parsed = arg({ '--arch': String }, { argv });

    const archValue = parsed['--arch'] ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
    if (archValue !== 'x64' && archValue !== 'arm64' && archValue !== 'all') {
        throw new Error(`Unsupported --arch value: ${archValue}. Use x64, arm64, or all.`);
    }

    return { arch: archValue };
}

function resolveArchTargets(arch: RuntimeArchArg): RuntimeArch[] {
    if (arch === 'all') {
        return ['x64', 'arm64'];
    }
    return [arch];
}

function runPkgBuild(
    runtimeEntryPath: string,
    exePath: string,
    arch: RuntimeArch,
    nodeTarget: string,
    cwd: string
): void {
    const pkgCliPath = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
    const result = spawnSync(
        process.execPath,
        [
            pkgCliPath,
            runtimeEntryPath,
            '--target',
            `${nodeTarget}-win-${arch}`,
            '--no-bytecode',
            '--public',
            '--output',
            exePath,
        ],
        {
            cwd,
            stdio: 'inherit',
        }
    );

    if (result.error) {
        throw new Error(`[galdur-runtime] pkg invocation failed: ${String(result.error)}`);
    }

    if (result.status !== 0) {
        throw new Error(`[galdur-runtime] pkg build failed for ${arch} with exit code ${String(result.status)}`);
    }
}

async function stageDependencies(rootPath: string, targetNodeModules: string): Promise<void> {
    const sourceNodeModules = join(rootPath, 'node_modules');
    await mkdir(targetNodeModules, { recursive: true });

    const deps = ['node-pty', 'node-addon-api'];
    for (const dep of deps) {
        const source = join(sourceNodeModules, dep);
        if (!existsSync(source)) {
            continue;
        }
        const target = join(targetNodeModules, dep);
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true, force: true });
    }
}

async function createRuntimeBundle(
    rootPath: string,
    outPath: string,
    exeName: string,
    bundlePath: string
): Promise<void> {
    if (process.platform !== 'win32') {
        throw new Error('[galdur-runtime] Bundling runtime zips is currently supported on Windows only.');
    }

    const bundleDir = join(outPath, '.tmp', exeName.replace(/\.exe$/i, ''));
    const sourceExePath = join(outPath, exeName);

    await rm(bundleDir, { recursive: true, force: true });
    await mkdir(bundleDir, { recursive: true });
    await copyFile(sourceExePath, join(bundleDir, exeName));
    await stageDependencies(rootPath, join(bundleDir, 'node_modules'));

    runPowerShellArchive(bundleDir, bundlePath, rootPath);
}

function runPowerShellArchive(sourceDir: string, archivePath: string, cwd: string): void {
    const result = spawnSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "& { param($SourceDir, $ArchivePath) Compress-Archive -Path (Join-Path $SourceDir '*') -DestinationPath $ArchivePath -CompressionLevel Optimal -Force }",
            sourceDir,
            archivePath,
        ],
        {
            cwd,
            stdio: 'inherit',
        }
    );

    if (result.error) {
        throw new Error(`[galdur-runtime] archive creation failed: ${String(result.error)}`);
    }

    if (result.status !== 0) {
        throw new Error(`[galdur-runtime] archive creation failed with exit code ${String(result.status)}`);
    }
}

async function hashFile(filePath: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function readPluginVersion(rootPath: string): Promise<string> {
    const packageJsonPath = join(rootPath, 'package.json');
    const manifestPath = join(rootPath, 'manifest.json');

    const packageVersion = await readJsonVersion(packageJsonPath);
    const manifestVersion = await readJsonVersion(manifestPath);

    if (packageVersion !== manifestVersion) {
        throw new Error(
            `[galdur-runtime] Version mismatch: package.json=${packageVersion} manifest.json=${manifestVersion}. Keep them in sync before building runtime.`
        );
    }

    return packageVersion;
}

async function readJsonVersion(filePath: string): Promise<string> {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (!parsed || typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
        throw new Error(`[galdur-runtime] Missing version in ${filePath}`);
    }
    return parsed.version.trim();
}

async function buildVersionedRuntimeEntry(
    runtimeEntryPath: string,
    outputDir: string,
    version: string
): Promise<string> {
    const raw = await readFile(runtimeEntryPath, 'utf8');
    const placeholder = '__GALDUR_RUNTIME_VERSION__';
    if (!raw.includes(placeholder)) {
        throw new Error(`[galdur-runtime] Missing placeholder token in runtime entry: ${placeholder}`);
    }

    const escapedVersion = JSON.stringify(version).slice(1, -1);
    const baked = raw.split(placeholder).join(escapedVersion);
    const tempDir = join(outputDir, '.tmp');
    await mkdir(tempDir, { recursive: true });
    const tempEntry = join(tempDir, 'galdur-runtime.versioned.js');
    await writeFile(tempEntry, baked, 'utf8');
    return tempEntry;
}

async function buildRuntimeJs(rootPath: string): Promise<void> {
    const entry = join(rootPath, 'runtime', 'src', 'index.ts');
    const outfile = join(rootPath, 'runtime', 'galdur-runtime.js');
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
