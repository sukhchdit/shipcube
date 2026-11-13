import { Prisma } from '@prisma/client';

/** PR11-SEC-17 a: `new (Prisma.sql.constructor)(…)`: the helper's constructor builds code or fragments from text. */
export const forge = (text: string): unknown => new (Prisma.sql.constructor as new (body: string) => unknown)(text);
