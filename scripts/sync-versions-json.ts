import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import process from 'process';
import { fileURLToPath, pathToFileURL } from 'url';

type JsonRecord = Record<string, unknown>;
type VersionsRecord = Record<string, string>;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptFile);
const rootDir = join(scriptDir, '..');

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    void main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

async function main(): Promise<void> {
    const synced = await syncVersionsJson(rootDir);
    console.log(`Synced versions.json for ${synced.version} -> minAppVersion ${synced.minAppVersion}`);
}

export async function syncVersionsJson(rootPath: string): Promise<{ version: string; minAppVersion: string }> {
    const packageJsonPath = join(rootPath, 'package.json');
    const manifestJsonPath = join(rootPath, 'manifest.json');
    const versionsJsonPath = join(rootPath, 'versions.json');

    const [packageJson, manifestJson, versionsJson] = await Promise.all([
        readJson(packageJsonPath),
        readJson(manifestJsonPath),
        readJson(versionsJsonPath),
    ]);

    const packageVersion = readRequiredVersion(packageJson, 'version', 'package.json');
    const manifestVersion = readRequiredVersion(manifestJson, 'version', 'manifest.json');
    if (packageVersion !== manifestVersion) {
        throw new Error(
            `Version mismatch: package.json=${packageVersion} manifest.json=${manifestVersion}. Sync them before updating versions.json.`
        );
    }

    const minAppVersion = readRequiredVersion(manifestJson, 'minAppVersion', 'manifest.json');
    const nextVersions = sortVersionsMap({
        ...normalizeVersionsMap(versionsJson, versionsJsonPath),
        [packageVersion]: minAppVersion,
    });

    await writeFile(versionsJsonPath, `${JSON.stringify(nextVersions, null, 4)}\n`, 'utf8');

    return {
        version: packageVersion,
        minAppVersion,
    };
}

export function sortVersionsMap(versions: VersionsRecord): VersionsRecord {
    const sortedEntries = Object.entries(versions).sort(([left], [right]) => compareVersions(left, right));
    return Object.fromEntries(sortedEntries);
}

export function compareVersions(left: string, right: string): number {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);

    for (let index = 0; index < leftParts.length; index += 1) {
        const delta = leftParts[index] - rightParts[index];
        if (delta !== 0) {
            return delta;
        }
    }

    return 0;
}

function normalizeVersionsMap(raw: JsonRecord, filePath: string): VersionsRecord {
    const normalized: VersionsRecord = {};
    for (const [version, minAppVersion] of Object.entries(raw)) {
        assertValidVersion(version, `versions.json key in ${filePath}`);
        if (typeof minAppVersion !== 'string' || minAppVersion.trim().length === 0) {
            throw new Error(`Invalid versions.json value for ${version}. Expected a minAppVersion string.`);
        }
        assertValidVersion(minAppVersion, `versions.json value for ${version}`);
        normalized[version] = minAppVersion.trim();
    }
    return normalized;
}

function parseVersion(version: string): [number, number, number] {
    assertValidVersion(version, 'version');
    const match = VERSION_PATTERN.exec(version);
    if (!match) {
        throw new Error(`Invalid version: ${version}`);
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function assertValidVersion(version: string, label: string): void {
    if (!VERSION_PATTERN.test(version)) {
        throw new Error(`Invalid ${label}: ${version}. Expected x.y.z.`);
    }
}

function readRequiredVersion(value: JsonRecord, field: string, label: string): string {
    const fieldValue = value[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
        throw new Error(`Missing ${field} in ${label}.`);
    }

    const normalizedValue = fieldValue.trim();
    assertValidVersion(normalizedValue, `${field} in ${label}`);
    return normalizedValue;
}

async function readJson(filePath: string): Promise<JsonRecord> {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
        throw new Error(`Expected a JSON object in ${filePath}.`);
    }
    return parsed;
}

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
