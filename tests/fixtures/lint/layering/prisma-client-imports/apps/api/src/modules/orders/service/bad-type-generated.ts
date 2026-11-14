// D-ARCH-103 (2): a service imports nothing from the generated client, not even a type: refused.
import type { PrismaClient } from '../../../../../../prisma/generated/prisma/client.js';

export type OrdersClient = PrismaClient;
