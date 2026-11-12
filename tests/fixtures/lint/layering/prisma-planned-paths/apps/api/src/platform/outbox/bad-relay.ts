import type { Prisma } from '@prisma/client';

export const relay = (tx: Prisma.TransactionClient): unknown => tx;
