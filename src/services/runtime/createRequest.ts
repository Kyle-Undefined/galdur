import { RUNTIME_PROTOCOL_VERSION } from '../../constants';
import { RuntimeCommandType, RuntimeRequest, RuntimeRequestPayloadMap } from '../../../shared/ipc-types';

export function createRequest<T extends RuntimeCommandType>(
    id: string,
    authToken: string,
    type: T,
    payload: RuntimeRequestPayloadMap[T]
): RuntimeRequest<T> {
    return {
        id,
        authToken,
        type,
        payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
    };
}
