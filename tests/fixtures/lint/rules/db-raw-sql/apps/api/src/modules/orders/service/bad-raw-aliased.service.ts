import { Prisma as P } from '@prisma/client';

const { raw: fragment } = P;

export const orderBy = (column: string): unknown => fragment(column);
