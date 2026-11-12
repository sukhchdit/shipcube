import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export const createDatabaseClient = (): PrismaClient => new PrismaClient({ adapter: new PrismaPg({}) } as never);
