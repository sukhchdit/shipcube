interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/** PR11-SEC-17 a: an aliased $queryRaw: the alias can later be called with a pre-built Sql object. */
export const run = (db: RawClient): Promise<unknown> => {
  const query = db.$queryRaw.bind(db);
  return query`SELECT 1`;
};
