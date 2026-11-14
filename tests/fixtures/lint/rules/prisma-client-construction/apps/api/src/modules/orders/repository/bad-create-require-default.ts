import module from 'node:module';

/** PR44-SEC-01 F11: createRequire as a member of the default import of node:module. */
export const generated = (): unknown => module.createRequire(import.meta.url)('@platform/prisma/client');
