interface RawClient {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * PR44-SEC-05 / D-SEC-PR42-02 (020-D): the setters no other rule sees: UPDATE pg_settings (a session SET), an
 * anonymous DO block that builds its setter from concatenated text, and the setting function with a non-literal
 * is_local (a bind parameter can be false).
 */
export const shapes = (db: RawClient, local: boolean): Promise<number>[] => [
  db.$executeRaw`UPDATE pg_catalog.pg_settings SET setting = 'elsewhere' WHERE name = 'search_path'`,
  db.$executeRaw`DO $body$ BEGIN EXECUTE 'SET ' || 'search_path = elsewhere'; END $body$`,
  db.$executeRaw`SELECT pg_catalog.set_config('search_path', 'elsewhere', ${local})`,
];
