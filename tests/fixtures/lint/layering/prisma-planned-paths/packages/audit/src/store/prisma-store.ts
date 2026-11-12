import type { Prisma } from '@prisma/client';

export const auditStore = (tx: Prisma.TransactionClient): unknown => tx;
