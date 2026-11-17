import * as nm from 'node:module';

/** PR44-SEC-10 / code review R2-m2 p9: a no-substitution template-literal key names createRequire. */
export const generated = (): unknown => nm[`createRequire`](import.meta.url)('@platform/prisma/client');
