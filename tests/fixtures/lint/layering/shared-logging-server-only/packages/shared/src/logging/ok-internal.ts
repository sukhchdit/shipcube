import pino from 'pino';

import { CORRELATION_ID_MAX } from '../correlation/correlation-id.js';

import { createLogger } from './logger.js';

export const probe = (): unknown => [pino, createLogger, CORRELATION_ID_MAX];
