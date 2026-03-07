type TokenizeOptions = {
    allowEscapes: boolean;
};

function tokenize(line: string, options: TokenizeOptions): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const ch of line) {
        if (options.allowEscapes && escaping) {
            current += ch;
            escaping = false;
            continue;
        }

        if (options.allowEscapes && quote !== "'" && ch === '\\') {
            escaping = true;
            continue;
        }

        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }

        if (/\s/.test(ch)) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += ch;
    }

    if (options.allowEscapes && escaping) {
        current += '\\';
    }
    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

export function tokenizeCommandLine(line: string): string[] {
    return tokenize(line, { allowEscapes: false });
}

export function tokenizeArgLine(line: string): string[] {
    return tokenize(line, { allowEscapes: true });
}
