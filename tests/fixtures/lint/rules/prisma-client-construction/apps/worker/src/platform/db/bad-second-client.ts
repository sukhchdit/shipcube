import { PrismaClient } from '@prisma/client';

/** PR44-SEC-01 (code review p1/p3/p7): the worker's platform/db has no client-construction exemption. */
export const client = new PrismaClient({} as never);
