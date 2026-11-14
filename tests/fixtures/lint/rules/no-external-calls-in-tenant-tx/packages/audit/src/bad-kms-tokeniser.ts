interface AuditSqlPort {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

// PR42-SEC-07: a tokeniser receives the business transaction as `db: AuditSqlPort`, so it is a T-83 root: a KMS call
// and a sleep in it hold a pool connection and an admission permit.
export async function tokenise(db: AuditSqlPort, url: string): Promise<readonly string[]> {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fetch(url);
  return db.$queryRaw<string[]>`SELECT 1`;
}
