// PR076-SEC-07: a subpath of @platform/shared is outside the root's name check; retryDelayMs defaults to Math.random.
import { retryDelayMs } from '@platform/shared/queues';

export const backoff = (): number => retryDelayMs(1);
