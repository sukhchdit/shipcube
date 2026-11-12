import { Prisma } from '@prisma/client';

interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** Positive control (PR11-SEC-13): tagged fragments, join with the default or a literal separator, tagged $queryRaw. */
export const run = (db: RawClient, ids: readonly string[], status: string): Promise<unknown> => {
  const filter = Prisma.sql`status = ${status}`;
  return db.$queryRaw`SELECT id FROM orders WHERE id IN (${Prisma.join(ids)}) AND ${filter} AND ref IN (${Prisma.join(ids, ', ')})`;
};
