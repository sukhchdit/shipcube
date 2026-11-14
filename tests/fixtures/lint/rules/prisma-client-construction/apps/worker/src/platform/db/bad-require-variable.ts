import { createRequire } from 'node:module';

const r = createRequire(import.meta.url);

/** PR44-SEC-01 (code review p1): a createRequire loader kept in a variable, in the worker's platform/db. */
export const generated = (): unknown => r('@platform/prisma/client');
