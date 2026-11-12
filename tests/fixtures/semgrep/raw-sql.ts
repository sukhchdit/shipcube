// Semgrep test fixture for .semgrep/raw-sql.yml (REQ-SEC-009). Never executed.
import { Prisma } from '@prisma/client';

interface Db {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
  $executeRaw: (...args: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
}
interface Pool {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

export async function queries(db: Db, pool: Pool, id: string, table: string): Promise<unknown[]> {
  // ruleid: platform.raw-sql.unsafe-api
  const a = await db.$queryRawUnsafe(`SELECT * FROM orders WHERE id = '${id}'`);
  // ruleid: platform.raw-sql.unsafe-api
  const b = await db.$executeRawUnsafe('DELETE FROM orders WHERE id = $1', id);
  // ruleid: platform.raw-sql.unsafe-api
  const c = Prisma.raw(table);
  // ruleid: platform.raw-sql.interpolated-query
  const d = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  // ruleid: platform.raw-sql.interpolated-query
  const e = await pool.query('SELECT * FROM orders WHERE id = ' + id);
  // ruleid: platform.raw-sql.interpolated-query
  const f = await db.$queryRaw(`SELECT * FROM orders WHERE id = '${id}'`);
  // ok: platform.raw-sql.interpolated-query
  const g = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  // ok: platform.raw-sql.interpolated-query
  const h = await db.$queryRaw`SELECT * FROM orders WHERE id = ${id}`;
  // ok: platform.raw-sql.unsafe-api
  const i = await db.$executeRaw(Prisma.sql`UPDATE orders SET seen = true WHERE id = ${id}`);
  // ok: platform.raw-sql.interpolated-query
  const j = await pool.query(`SELECT 1`);
  return [a, b, c, d, e, f, g, h, i, j];
}
