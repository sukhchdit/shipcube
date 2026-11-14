// D-ARCH-114: a second apps/api/src/platform/db file imports the generated client as a VALUE: refused (generated.ts is
// the one value importer; the others use the types of platform/db/index.ts).
import { Prisma } from '../../../../../prisma/generated/prisma/client.js';

export const fragment = Prisma.sql;
