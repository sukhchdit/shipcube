interface RawClient {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * PR54-SEC-01, code review R1-M1 (PR #54): a SYSTEM table hidden by a reading the lexer once had and PostgreSQL does
 * not: a line comment ended by CR, a continued E string, Prisma's `$1` rendering of `$q${v}$q$`, and a Unicode space
 * before a dollar tag (unreadable, fails closed).
 */
export const disguised = (db: RawClient, id: string): Promise<unknown[]>[] => [
  db.$queryRaw<unknown[]>`SELECT * FROM -- x\raudit_entries`,
  db.$queryRaw<unknown[]>`SELECT E'a'\n'\\', ' AS s, e.* FROM audit_entries e, ' -- '`,
  db.$queryRaw<unknown[]>`SELECT 1 AS $q${id}$q$, e.* FROM audit_entries e -- $q$`,
  db.$queryRaw<unknown[]>`SELECT 1 AS \xa0$q$, e.* FROM audit_entries e, (SELECT 1) AS \xa0$q$`,
];
