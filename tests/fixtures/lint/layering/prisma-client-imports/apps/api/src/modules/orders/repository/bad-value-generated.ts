// D-ARCH-103 (2): a repository imports the generated client as a VALUE: refused (it receives a TenantDb).
import { Prisma } from '../../../../../../prisma/generated/prisma/client.js';

export const fragment = Prisma.sql;
