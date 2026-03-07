import { GaldurSettings, RuntimeBackend } from '../../types';
import { Backend } from './Backend';
import { HostService } from './HostService';

export function createBackend(host: HostService, settings: GaldurSettings): RuntimeBackend {
    return new Backend({
        host,
        settings,
    });
}
