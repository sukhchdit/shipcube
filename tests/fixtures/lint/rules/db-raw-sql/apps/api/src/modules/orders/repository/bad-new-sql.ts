import { Prisma } from '@prisma/client';

export const fragment = (column: string): unknown => new Prisma.Sql([column], []);
