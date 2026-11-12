import type { PrismaClient } from '@prisma/client';

export type Client = Pick<PrismaClient, '$transaction'>;
