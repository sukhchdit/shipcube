import { createRequire as mk } from 'node:module';

/** PR44-SEC-01 F09: an import alias of createRequire, called and the result called with the generated client. */
export const generated = (): unknown => mk(import.meta.url)('@platform/prisma/client');
