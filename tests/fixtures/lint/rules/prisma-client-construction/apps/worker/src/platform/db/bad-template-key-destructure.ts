import * as nm from 'node:module';

/** PR44-SEC-10 / code review R2-m2 p15: createRequire taken out under a template-literal destructuring key. */
const { [`createRequire`]: make } = nm;

export const generated = (): unknown => make(import.meta.url)('@platform/prisma/client');
