// PR38-SEC-01: the workspace specifier of the generated client exports the same SQL helpers as @prisma/client, and
// platform/db (the root client's folder) may import it as a value.
import { Prisma } from '@platform/prisma/client';

const { raw } = Prisma;

export const fragment = (column: string): unknown => raw(column);
