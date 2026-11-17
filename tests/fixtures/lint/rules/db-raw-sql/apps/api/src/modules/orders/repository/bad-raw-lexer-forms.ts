interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * PR54-SEC-01 / PR54-SEC-02 (a), code review R1-M1 / R1-m3 (PR #54): statements the lexer once read differently from
 * PostgreSQL, and the session forms added to the refused set. Each is one `rawStatement` finding.
 */
export const shapes = (db: RawClient, id: string): Promise<number>[] => [
  db.$executeRaw`SELECT 1 -- note\r; COMMIT; SELECT 2`,
  db.$executeRaw`SELECT 1 AS \xa0$q$; COMMIT; SELECT 1 AS \xa0$q$`,
  db.$executeRaw`SELECT E'a'\n'\\' ; ' ; COMMIT ; SELECT ' -- '`,
  db.$executeRaw`SELECT 1 AS $q${id}$q$, 2; COMMIT; SELECT 3 -- $q$`,
  db.$executeRaw`DECLARE leak CURSOR WITH HOLD FOR SELECT * FROM orders WHERE id = ${id}`,
  db.$executeRaw`FETCH ALL FROM leak`,
  db.$executeRaw`SELECT pg_advisory_lock(${id})`,
  db.$executeRaw`SELECT current_setting('standard_conforming_strings')`,
];
