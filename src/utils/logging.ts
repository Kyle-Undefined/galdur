import { PLUGIN_ID } from '../constants';

export function swallowError(error: unknown): void {
    console.warn(`[${PLUGIN_ID}]`, error);
}
