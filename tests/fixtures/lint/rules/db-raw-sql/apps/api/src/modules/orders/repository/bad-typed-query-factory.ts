import { makeTypedQueryFactory } from '@prisma/client/runtime/client';

export const typed = (sql: string): unknown => makeTypedQueryFactory(sql);
