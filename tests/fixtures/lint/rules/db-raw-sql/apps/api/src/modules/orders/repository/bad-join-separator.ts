import { Prisma } from '@prisma/client';

export const list = (ids: readonly string[], separator: string): unknown => Prisma.join(ids, separator);
