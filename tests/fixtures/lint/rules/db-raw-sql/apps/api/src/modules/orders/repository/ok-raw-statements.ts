interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * PR44-SEC-05 positive control: ordinary statements whose text merely contains the keywords (a quoted column "end", a
 * string, a comment, an UPDATE ... SET, a WITH). The transaction-local setter with a literal true is allowed too; it
 * is proven by the shared corpus (tests/fixtures/sql/raw-statement-corpus.json), since its name is a
 * platform/tenant-context-sql form in any fixture.
 */
export const shapes = (db: RawClient, id: string): Promise<unknown>[] => [
  db.$queryRaw`SELECT "end", 'COMMIT' AS label FROM orders WHERE id = ${id} -- then ROLLBACK`,
  db.$queryRaw`UPDATE orders SET status = 'set' WHERE id = ${id}`,
  db.$queryRaw`WITH changed AS (UPDATE orders SET status = 'done' WHERE id = ${id} RETURNING id) SELECT id FROM changed`,
];
