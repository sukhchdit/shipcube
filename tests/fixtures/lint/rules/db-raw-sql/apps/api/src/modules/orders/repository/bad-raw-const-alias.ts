import { Prisma } from '@prisma/client';

const r = Prisma.raw;

export const fragment = (column: string): unknown => r(column);
