import type { Prisma } from '@prisma/client';

export const writeOutbox = (tx: Prisma.TransactionClient): unknown => tx;
