// D-ARCH-103 (5): the planned audit store (TASK-025) may import the generated client types: allowed.
import type { PrismaClient } from '../../../../prisma/generated/prisma/client.js';

export type AuditClient = PrismaClient;
