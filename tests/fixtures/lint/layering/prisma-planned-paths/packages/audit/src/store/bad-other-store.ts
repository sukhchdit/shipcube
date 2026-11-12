import type { Prisma } from '@prisma/client';

export const otherStore = (tx: Prisma.TransactionClient): unknown => tx;
