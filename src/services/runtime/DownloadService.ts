import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import * as https from 'https';
import { stat, unlink } from 'fs/promises';
import { pipeline } from 'stream/promises';
import {
    ALLOWED_DOWNLOAD_HOST_SUFFIXES,
    CHECKSUM_SHA256_HEX_LENGTH,
    DOWNLOAD_MAX_REDIRECTS,
    DOWNLOAD_TIMEOUT_MS,
    HTTP_REDIRECT_CODES,
    HTTP_SUCCESS_MAX_EXCLUSIVE,
    HTTP_SUCCESS_MIN,
} from '../../constants';

const CHECKSUM_LINE_PATTERN = new RegExp(`^([A-Fa-f0-9]{${CHECKSUM_SHA256_HEX_LENGTH}})\\s+\\*?(.+)$`);

export class DownloadService {
    public async downloadText(url: string): Promise<string> {
        const chunks: Buffer[] = [];
        await this.download(url, (chunk) => {
            chunks.push(chunk);
        });
        return Buffer.concat(chunks).toString('utf8');
    }

    public async downloadFile(url: string, outputPath: string): Promise<void> {
        await this.download(url, undefined, outputPath);
    }

    public async sha256File(filePath: string): Promise<string> {
        const info = await stat(filePath);
        if (!info.isFile()) {
            throw new Error(`Expected runtime artifact to be a file: ${filePath}`);
        }
        const hash = createHash('sha256');
        await pipeline(createReadStream(filePath), hash);
        return hash.digest('hex');
    }

    public extractChecksum(content: string, fileName: string): string | null {
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const match = CHECKSUM_LINE_PATTERN.exec(trimmed);
            if (!match) {
                continue;
            }
            const [, hash, name] = match;
            if (name.trim() === fileName) {
                return hash;
            }
        }
        return null;
    }

    private async download(
        url: string,
        onChunk?: (chunk: Buffer) => void,
        outputPath?: string,
        redirects = 0
    ): Promise<void> {
        if (redirects > DOWNLOAD_MAX_REDIRECTS) {
            throw new Error(`Too many redirects while downloading ${url}`);
        }

        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'https:') {
            throw new Error(`Only HTTPS URLs are supported: ${url}`);
        }
        if (!isAllowedDownloadHost(parsedUrl.hostname)) {
            throw new Error(`Download host is not allowed: ${parsedUrl.hostname}`);
        }

        await new Promise<void>((resolve, reject) => {
            let finished = false;

            const finish = (error?: unknown): void => {
                if (finished) {
                    return;
                }
                finished = true;
                const normalizedError =
                    error instanceof Error ? error : error === undefined ? undefined : new Error(String(error));

                if (normalizedError) {
                    if (outputPath) {
                        void unlink(outputPath).catch((e: NodeJS.ErrnoException) => {
                            if (e.code !== 'ENOENT') {
                                console.warn('[galdur] Failed to clean up partial download:', e);
                            }
                        });
                    }
                    reject(normalizedError);
                } else {
                    resolve();
                }
            };

            const request = https.get(url, (response) => {
                const statusCode = response.statusCode ?? 0;
                const location = response.headers.location;
                if (HTTP_REDIRECT_CODES.some((redirectCode) => statusCode === redirectCode) && location) {
                    finished = true;
                    response.destroy();
                    request.destroy();
                    const redirectUrl = new URL(location, parsedUrl).toString();
                    void this.download(redirectUrl, onChunk, outputPath, redirects + 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                if (statusCode < HTTP_SUCCESS_MIN || statusCode >= HTTP_SUCCESS_MAX_EXCLUSIVE) {
                    response.destroy();
                    finish(new Error(`Failed downloading ${url}. HTTP ${statusCode}`));
                    return;
                }

                const stream = outputPath ? createWriteStream(outputPath) : null;

                if (stream) {
                    void pipeline(response, stream)
                        .then(() => {
                            finish();
                        })
                        .catch((error) => {
                            finish(error);
                        });
                    return;
                }

                response.on('data', (chunk: Buffer | string) => {
                    if (onChunk) {
                        onChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    }
                });

                response.on('error', (error) => {
                    finish(error instanceof Error ? error : new Error(String(error)));
                });

                response.on('end', () => {
                    finish();
                });
            });

            request.on('error', (error) => {
                finish(error);
            });

            request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
                request.destroy();
                finish(new Error(`Request timeout while downloading ${url}`));
            });
        });
    }
}

function isAllowedDownloadHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return ALLOWED_DOWNLOAD_HOST_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}
