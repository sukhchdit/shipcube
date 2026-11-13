import { Prisma } from '@prisma/client';

type SqlClass = new (strings: readonly string[], values: readonly unknown[]) => unknown;

/** PR11-SEC-17 a: a tagged fragment's constructor is Prisma's Sql class, which splices any string as SQL text. */
export const forge = (text: string): unknown => {
  const fragment = Prisma.sql`SELECT 1`;
  return new (fragment.constructor as SqlClass)([text], []);
};
