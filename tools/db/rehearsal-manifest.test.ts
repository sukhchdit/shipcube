/**
 * The backup manifest of the restore rehearsal (data-model.md §8.6; NT-REC-003-a, NT-DATA-004-c; TASK-034): the SQL it
 * generates, the capture over a fake session, the comparison and the file boundary. The PostgreSQL 18 run is
 * prisma/tests/migrations/backup-restore.int.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import {
  FOREIGN_KEYS_SQL,
  MANIFEST_FORMAT,
  MANIFEST_SESSION_SETTINGS,
  MIGRATION_HEAD_SQL,
  MIGRATION_TABLE_SQL,
  RehearsalError,
  SEQUENCES_SQL,
  SERVER_VERSION_SQL,
  TABLES_SQL,
  applySessionSettings,
  canonicalJson,
  captureManifest,
  captureSequences,
  compareManifests,
  findOrphans,
  manifestSha256,
  manifestTotals,
  orphanCountSql,
  parseManifest,
  sha256Hex,
  tableFingerprintSql,
  type BackupManifest,
  type ForeignKey,
  type SqlSession,
} from './rehearsal-manifest.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

/** A session answering by exact SQL text or by a predicate; records every statement. */
function fakeSession(answer: (sql: string, params?: readonly unknown[]) => object[]): SqlSession & { statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    async query<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      await tick();
      statements.push(sql);
      return answer(sql, params) as T[];
    },
  };
}

const manifest = (overrides: Partial<BackupManifest> = {}): BackupManifest => ({
  format: MANIFEST_FORMAT,
  database: 'platform',
  serverVersionNum: '180001',
  takenAt: '2026-11-21T10:00:00.000Z',
  migrationHead: '20261119000000_job_executions',
  schemaSha256: sha256Hex('schema'),
  tables: [
    { table: 'public.a', rows: '3', checksum: '123' },
    { table: 'public.b', rows: '0', checksum: '0' },
  ],
  sequences: [{ sequence: 'public.a_id_seq', lastValue: '3' }],
  ...overrides,
});

const FK: ForeignKey = {
  name: 'fk_child__parent',
  childSchema: 'public',
  childTable: 'child',
  parentSchema: 'public',
  parentTable: 'parent',
  childColumns: ['parent_id', 'org_id'],
  parentColumns: ['id', 'org_id'],
  operators: ['=', '='],
  operatorSchemas: ['pg_catalog', 'pg_catalog'],
};

describe('generated SQL', () => {
  it('fingerprints one table with ONLY, an order-independent 60-bit SHA-256 sum and quoted names', () => {
    const sql = tableFingerprintSql('public', 'odd"name');
    expect(sql).toContain('FROM ONLY "public"."odd""name" AS t');
    expect(sql).toContain("pg_catalog.sha256(pg_catalog.convert_to(t::pg_catalog.text, 'UTF8'))");
    expect(sql).toContain('::pg_catalog.bit(60)::pg_catalog.int8');
    expect(sql).toMatch(/^SELECT pg_catalog\.count\(\*\)::pg_catalog\.text AS rows, pg_catalog\.coalesce\(pg_catalog\.sum\(/);
  });

  it("builds the orphan anti-join with the constraint's own operators, MATCH SIMPLE null handling and no ONLY", () => {
    expect(orphanCountSql(FK)).toBe(
      'SELECT pg_catalog.count(*)::pg_catalog.text AS orphans FROM "public"."child" AS c WHERE c."parent_id" IS NOT NULL AND c."org_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."parent" AS p WHERE p."id" OPERATOR("pg_catalog".=) c."parent_id" AND p."org_id" OPERATOR("pg_catalog".=) c."org_id")',
    );
    expect(orphanCountSql({ ...FK, operators: ['=', '='], operatorSchemas: ['public', 'public'] })).toContain('OPERATOR("public".=)');
  });

  it('refuses an inconsistent key and an operator name outside the operator characters (catalog text never reaches SQL unchecked)', () => {
    expect(() => orphanCountSql({ ...FK, parentColumns: ['id'] })).toThrow(RehearsalError);
    expect(() => orphanCountSql({ ...FK, childColumns: [], parentColumns: [], operators: [], operatorSchemas: [] })).toThrow(
      /inconsistent/,
    );
    expect(() => orphanCountSql({ ...FK, operators: ['=', '=) OR (true'] })).toThrow(/unexpected operator name/);
  });

  it('reads catalogs schema-qualified and skips the system schemas', () => {
    for (const sql of [TABLES_SQL, SEQUENCES_SQL, FOREIGN_KEYS_SQL]) expect(sql).toMatch(/pg_catalog\.pg_/);
    expect(TABLES_SQL).toContain("c.relkind = 'r'");
    expect(TABLES_SQL).toContain("n.nspname !~ '^pg_'");
    expect(FOREIGN_KEYS_SQL).toContain("c.contype = 'f' AND c.conparentid = 0");
    expect(MANIFEST_SESSION_SETTINGS).toContain("SET TimeZone = 'UTC'");
    expect(MANIFEST_SESSION_SETTINGS).toContain('SET extra_float_digits = 3');
  });
});

describe('capture', () => {
  const catalog = (migrations: boolean) =>
    fakeSession((sql) => {
      if (sql === TABLES_SQL)
        return [
          { schema: 'public', name: 'a' },
          { schema: 'audit', name: 'b' },
        ];
      if (sql.startsWith('SELECT pg_catalog.count(*)::pg_catalog.text AS rows')) {
        return sql.includes('"public"."a"') ? [{ rows: '3', checksum: '123' }] : [];
      }
      if (sql === SERVER_VERSION_SQL) return [{ version: '180001' }];
      if (sql === MIGRATION_TABLE_SQL) return [{ present: migrations }];
      if (sql === MIGRATION_HEAD_SQL) return [{ migration_name: '20261119000000_job_executions' }];
      if (sql === SEQUENCES_SQL)
        return [
          { schema: 'public', name: 'a_id_seq', last_value: '3' },
          { schema: 'public', name: 'n', last_value: null },
        ];
      return [];
    });

  it('fingerprints every table in catalog order, with the migration head and the schema digest', async () => {
    const session = catalog(true);
    const sequences = await captureSequences(session);
    expect(sequences).toEqual([
      { sequence: 'public.a_id_seq', lastValue: '3' },
      { sequence: 'public.n', lastValue: null },
    ]);
    const captured = await captureManifest(session, { database: 'platform', takenAt: 'T', schema: 'CREATE TABLE a ();', sequences });
    expect(captured).toEqual({
      format: MANIFEST_FORMAT,
      database: 'platform',
      serverVersionNum: '180001',
      takenAt: 'T',
      migrationHead: '20261119000000_job_executions',
      schemaSha256: sha256Hex('CREATE TABLE a ();'),
      tables: [
        { table: 'public.a', rows: '3', checksum: '123' },
        { table: 'audit.b', rows: '0', checksum: '0' },
      ],
      sequences,
    });
  });

  it('has a null head without _prisma_migrations (a bootstrapped-only database) and an empty version when unreadable', async () => {
    const session = fakeSession((sql) => (sql === MIGRATION_TABLE_SQL ? [{ present: false }] : []));
    const captured = await captureManifest(session, { database: 'd', takenAt: 'T', schema: '', sequences: [] });
    expect(captured.migrationHead).toBeNull();
    expect(captured.serverVersionNum).toBe('');
    expect(session.statements).not.toContain(MIGRATION_HEAD_SQL);
  });

  it('applies the session settings in order', async () => {
    const session = fakeSession(() => []);
    await applySessionSettings(session);
    expect(session.statements).toEqual(MANIFEST_SESSION_SETTINGS);
  });

  it('reports only foreign keys with orphans, by constraint and table, counts only', async () => {
    const row = {
      name: 'fk_a',
      child_schema: 'public',
      child_table: 'child',
      parent_schema: 'public',
      parent_table: 'parent',
      child_columns: ['parent_id'],
      parent_columns: ['id'],
      operators: ['='],
      operator_schemas: ['pg_catalog'],
    };
    const session = fakeSession((sql) => {
      if (sql === FOREIGN_KEYS_SQL) return [row, { ...row, name: 'fk_b' }, { ...row, name: 'fk_c' }];
      if (sql.includes('AS orphans'))
        return session.statements.length === 2 ? [{ orphans: '2' }] : session.statements.length === 3 ? [{ orphans: '0' }] : [];
      return [];
    });
    expect(await findOrphans(session)).toEqual([{ constraint: 'fk_a', table: 'public.child', orphans: '2' }]);
  });
});

describe('compareManifests (the restore against its source)', () => {
  it('finds nothing between equal manifests, whatever the database name and time', () => {
    expect(compareManifests(manifest(), manifest({ database: 'rehearsal_x', takenAt: 'later' }))).toEqual([]);
  });

  it('names a missing, an extra, a short and a changed table, counts only', () => {
    const restored = manifest({
      tables: [
        { table: 'public.a', rows: '2', checksum: '99' },
        { table: 'public.c', rows: '1', checksum: '5' },
      ],
    });
    expect(compareManifests(manifest(), restored)).toEqual([
      'table public.a: 3 rows expected, 2 restored',
      'table public.b: missing in the restore',
      'table public.c: not in the source manifest',
    ]);
    expect(
      compareManifests(
        manifest(),
        manifest({
          tables: [
            { table: 'public.a', rows: '3', checksum: '124' },
            { table: 'public.b', rows: '0', checksum: '0' },
          ],
        }),
      ),
    ).toEqual(['table public.a: row checksum differs (3 rows)']);
  });

  it('flags a schema or migration-head difference', () => {
    expect(compareManifests(manifest(), manifest({ schemaSha256: sha256Hex('other'), migrationHead: null }))).toEqual([
      'schema: the normalised schema dump differs from the source',
      'migration head: expected 20261119000000_job_executions, restored null',
    ]);
  });

  it('accepts a sequence that is ahead (live traffic after the manifest), refuses one behind or missing', () => {
    expect(compareManifests(manifest(), manifest({ sequences: [{ sequence: 'public.a_id_seq', lastValue: '9' }] }))).toEqual([]);
    expect(compareManifests(manifest(), manifest({ sequences: [{ sequence: 'public.a_id_seq', lastValue: '2' }] }))).toEqual([
      'sequence public.a_id_seq: restored 2 is behind the source 3',
    ]);
    expect(compareManifests(manifest(), manifest({ sequences: [{ sequence: 'public.a_id_seq', lastValue: null }] }))).toEqual([
      'sequence public.a_id_seq: restored null is behind the source 3',
    ]);
    expect(compareManifests(manifest(), manifest({ sequences: [] }))).toEqual(['sequence public.a_id_seq: missing in the restore']);
    const unused = manifest({ sequences: [{ sequence: 'public.a_id_seq', lastValue: null }] });
    expect(compareManifests(unused, manifest({ sequences: [{ sequence: 'public.a_id_seq', lastValue: null }] }))).toEqual([]);
  });
});

describe('digest and file boundary', () => {
  it('digests canonical JSON: key order never changes the digest, content does', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 1, y: undefined } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"z":1}}');
    const reordered = JSON.parse(JSON.stringify({ ...manifest(), format: MANIFEST_FORMAT })) as BackupManifest;
    expect(manifestSha256(reordered)).toBe(manifestSha256(manifest()));
    expect(manifestSha256(manifest({ takenAt: 'x' }))).not.toBe(manifestSha256(manifest()));
    expect(manifestSha256(manifest())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('parses a written manifest and refuses each malformed field by name', () => {
    expect(parseManifest(JSON.parse(JSON.stringify(manifest())) as unknown)).toEqual(manifest());
    const bad: [unknown, RegExp][] = [
      [null, /field root/],
      [{ ...manifest(), format: 'v0' }, /field format/],
      [{ ...manifest(), database: 1 }, /field database/],
      [{ ...manifest(), migrationHead: 2 }, /field migrationHead/],
      [{ ...manifest(), schemaSha256: 'abc' }, /field schemaSha256/],
      [{ ...manifest(), tables: 'x' }, /field tables/],
      [{ ...manifest(), tables: [{ table: 't', rows: '1e3', checksum: '0' }] }, /field tables\[0\]/],
      [{ ...manifest(), tables: [null] }, /field tables\[0\]/],
      [{ ...manifest(), sequences: {} }, /field sequences/],
      [{ ...manifest(), sequences: [{ sequence: 's', lastValue: 'x' }] }, /field sequences\[0\]/],
    ];
    for (const [raw, message] of bad) expect(() => parseManifest(raw)).toThrow(message);
  });

  it('totals tables and rows as bigint text', () => {
    expect(
      manifestTotals(
        manifest({
          tables: [
            { table: 'a', rows: '9007199254740993', checksum: '0' },
            { table: 'b', rows: '2', checksum: '0' },
          ],
        }),
      ),
    ).toEqual({
      tables: 2,
      rows: '9007199254740995',
    });
  });
});
