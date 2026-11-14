// D-ARCH-103 (2): prisma/tests import the generated client as a value: allowed.
import { PrismaClient } from '../../generated/prisma/client.js';

export const client = PrismaClient;
