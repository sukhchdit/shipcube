import { Prisma } from '@prisma/client';

export const fragment = (column: string): unknown => Prisma.raw(column);
