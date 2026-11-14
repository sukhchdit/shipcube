import * as m from 'node:module';

/** PR44-SEC-01 F10: createRequire as a member of a namespace import of node:module. */
export const generated = (): unknown => m.createRequire(import.meta.url)('@platform/prisma/client');
