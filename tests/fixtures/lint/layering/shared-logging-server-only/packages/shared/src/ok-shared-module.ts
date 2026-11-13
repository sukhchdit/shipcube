import { CORRELATION_ID_MAX } from './correlation/correlation-id.js';

export const probe = (): number => CORRELATION_ID_MAX;
