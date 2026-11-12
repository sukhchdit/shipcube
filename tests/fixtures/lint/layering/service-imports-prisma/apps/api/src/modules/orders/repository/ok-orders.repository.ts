import { PrismaClient } from '@prisma/client';

export const createClient = (): PrismaClient => new PrismaClient({} as never);
