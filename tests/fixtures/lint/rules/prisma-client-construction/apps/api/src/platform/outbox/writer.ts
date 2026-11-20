// PR2-SEC-05 addendum / PR11-SEC-05 item 2 (D-ARCH-074; TASK-043): the outbox writer constructs no PrismaClient of its
// own; it writes through the TenantDb of the business transaction.
import { PrismaClient } from '@prisma/client';

export const client = new PrismaClient({} as never);
