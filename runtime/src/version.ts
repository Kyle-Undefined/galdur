import * as fs from 'fs';
import * as path from 'path';

const EMBEDDED_RUNTIME_VERSION = '__GALDUR_RUNTIME_VERSION__';

export function resolveRuntimeVersion(): string {
    const placeholderToken = joinAtRuntime('__GALDUR_RUNTIME_', 'VERSION__');
    if (
        typeof EMBEDDED_RUNTIME_VERSION === 'string' &&
        EMBEDDED_RUNTIME_VERSION &&
        EMBEDDED_RUNTIME_VERSION !== placeholderToken
    ) {
        return EMBEDDED_RUNTIME_VERSION;
    }

    const envVersion = process.env.GALDUR_RUNTIME_VERSION;
    if (typeof envVersion === 'string' && envVersion.trim().length > 0) {
        return envVersion.trim();
    }

    const localVersion = resolveLocalPackageVersion();
    if (localVersion) {
        return localVersion;
    }

    return '0.0.0';
}

function resolveLocalPackageVersion(): string | null {
    const candidates = [path.join(__dirname, '..', 'package.json'), path.join(process.cwd(), 'package.json')];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }
        try {
            const raw = fs.readFileSync(candidate, 'utf8');
            const parsed = JSON.parse(raw) as { version?: unknown };
            if (parsed && typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
                return parsed.version.trim();
            }
        } catch {
            // Ignore malformed local package metadata and continue searching.
        }
    }

    return null;
}

function joinAtRuntime(a: string, b: string): string {
    return [a, b].join('');
}
