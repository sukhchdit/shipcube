import { createRequire } from 'node:module';

/** PR44-SEC-01 F08: a createRequire loader kept in a variable loads the generated client. */
const req = createRequire(import.meta.url);

export const generated = req('@platform/prisma/client') as unknown;
