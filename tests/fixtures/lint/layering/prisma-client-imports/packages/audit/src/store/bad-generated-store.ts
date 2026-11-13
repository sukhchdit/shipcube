// D-ARCH-103 (5): any other file of packages/audit imports nothing from the generated client: refused.
import type { PrismaClient } from '../../../../prisma/generated/prisma/client.js';

export type AuditClient = PrismaClient;
