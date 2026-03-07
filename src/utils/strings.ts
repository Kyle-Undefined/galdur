export function looksLikePath(value: string): boolean {
    return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value);
}

export function stripOuterQuotes(value: string): string {
    if (value.length >= 2) {
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            return value.slice(1, -1);
        }
    }
    return value;
}
