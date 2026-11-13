import { Prisma } from '@prisma/client';

/** PR11-SEC-17 a: the Prisma namespace stored in an object literal; `box.p.raw` is then invisible to the rule. */
export const box = { p: Prisma };
