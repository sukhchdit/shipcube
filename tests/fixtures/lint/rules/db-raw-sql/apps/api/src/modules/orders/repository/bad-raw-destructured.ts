import { Prisma } from '@prisma/client';

const { raw } = Prisma;

export const fragment = (column: string): unknown => raw(column);
