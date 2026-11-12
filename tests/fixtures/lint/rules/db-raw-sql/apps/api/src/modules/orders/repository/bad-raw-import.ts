import { raw } from '@prisma/client/runtime/client';

export const fragment = (column: string): unknown => raw(column);
