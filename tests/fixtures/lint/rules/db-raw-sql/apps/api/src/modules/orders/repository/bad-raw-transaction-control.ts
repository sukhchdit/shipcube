interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * PR44-SEC-05 (020-D): statements that end, nest or prepare the tenant transaction, whatever the case, comments or
 * position (a second statement after a semicolon counts).
 */
export const shapes = (db: RawClient, id: string): Promise<number>[] => [
  db.$executeRaw`COMMIT`,
  db.$executeRaw`rollback`,
  db.$executeRaw`/* done */ END`,
  db.$executeRaw`SELECT 1 WHERE ${id} IS NOT NULL; COMMIT`,
  db.$executeRaw`SAVEPOINT s1`,
  db.$executeRaw`BEGIN`,
  db.$executeRaw`PREPARE TRANSACTION 'x'`,
];
