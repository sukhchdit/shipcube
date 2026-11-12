import { Sql } from '@prisma/client/runtime/client';

export const fragment = (column: string): unknown => new Sql([column], []);
