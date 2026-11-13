import { createLogger } from '@platform/shared/logging';
import pino from 'pino';

export const probe = (): unknown => [createLogger, pino];
