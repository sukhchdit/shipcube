import { Prisma as P } from '@prisma/client';

export const fragment = (column: string): unknown => P.raw(column);
