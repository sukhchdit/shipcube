/**
 * Catalog suite `catalog-std` (US-064; NFR-DATA-002/003; REQ-RLS-009/012, REQ-ORG-007; data-model P2, P4, OI-24).
 * Runs on a clone of the fully migrated template. Every check is one SQL + one pure function in
 * ./standard-columns-scans.ts, run on the committed catalogue and again inside a transaction that is always rolled back
 * and holds planted violations, so each rule is proven to bite. The committed catalogue is never changed.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { PlatformPostgres } from '../harness/postgres.js';
import {
  CHECKS_SQL,
  COLUMNS_SQL,
  ON_BEHALF_SQL,
  OUR_SCHEMAS,
  PRIMARY_KEYS_SQL,
  STANDARD_COLUMNS_EXEMPT,
  dateZoneFindings,
  naiveTimestampFindings,
  onBehalfFindings,
  sequenceKeyFindings,
  standardColumnFindings,
  type CheckConstraintRow,
  type ColumnRow,
  type OnBehalfRow,
  type PrimaryKeyRow,
} from './standard-columns-scans.js';

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
});

type Row = pg.QueryResultRow;

async function withClient<T>(config: pg.ClientConfig | 'superuser', fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = config === 'superuser' ? await db.superuser(database) : new pg.Client(config);
  if (config !== 'superuser') await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  return withClient(db.migratorConnection(database), async (client) => {
    await client.query('BEGIN');
    try {
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  });
}

const rows = async <T extends Row>(client: pg.Client, sql: string, params: unknown[] = []): Promise<T[]> =>
  (await client.query<T>(sql, params)).rows;

/** The same reads for the committed catalogue (superuser) and for a planted transaction (migrator client). */
const columns = (client: pg.Client): Promise<ColumnRow[]> => rows<ColumnRow>(client, COLUMNS_SQL, [OUR_SCHEMAS]);
const publicColumns = async (client: pg.Client): Promise<ColumnRow[]> => (await columns(client)).filter((c) => c.schema_name === 'public');
const standardInput = async (client: pg.Client) => ({
  columns: await publicColumns(client),
  primaryKeys: await rows<PrimaryKeyRow>(client, PRIMARY_KEYS_SQL, ['public']),
  checks: await rows<CheckConstraintRow>(client, CHECKS_SQL, ['public']),
});
const committed = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withClient('superuser', fn);

/** A table that satisfies the whole standard-column contract; `overrides` replace one column definition by name. */
function standardTable(
  name: string,
  overrides: Record<string, string | null> = {},
  primaryKey: string | null = 'PRIMARY KEY (id)',
): string {
  const defs: Record<string, string> = {
    id: 'id uuid NOT NULL DEFAULT uuidv7()',
    created_at: 'created_at timestamptz NOT NULL DEFAULT now()',
    updated_at: 'updated_at timestamptz NOT NULL DEFAULT now()',
    created_by: 'created_by uuid NOT NULL',
    updated_by: 'updated_by uuid NOT NULL',
    version: 'version integer NOT NULL DEFAULT 1 CONSTRAINT ck_' + name + '__version CHECK (version >= 1)',
  };
  const body = Object.entries(defs)
    .map(([key, def]) => (key in overrides ? overrides[key] : def))
    .filter((def): def is string => def !== null && def !== undefined);
  return `CREATE TABLE public.${name} (${[...body, ...(primaryKey === null ? [] : [primaryKey])].join(', ')})`;
}

describe('catalog-std: standard columns, UTC time and the on-behalf seam (US-064; NFR-DATA-002/003; REQ-RLS-009/012, REQ-ORG-007)', () => {
  it('AT-US-064-04: a timestamp without time zone column is reported by table and column; time without time zone is allowed (planted control)', async () => {
    expect(naiveTimestampFindings(await committed(columns))).toEqual([]);
    const planted = await rolledBack(async (client) => {
      await client.query(`CREATE TABLE public.std_probe (id uuid PRIMARY KEY, seen_at timestamp NOT NULL, cutoff time NOT NULL,
                                                         ok_at timestamptz NOT NULL)`);
      await client.query('ALTER TABLE public.roles ADD COLUMN naive_at timestamp');
      return naiveTimestampFindings(await columns(client));
    });
    expect(planted).toEqual(['roles.naive_at: timestamp without time zone', 'std_probe.seen_at: timestamp without time zone']);
  }, 60_000);

  it('AT-US-064-05: every date column sits beside an IANA time-zone text column; exemptions are explicit (planted control)', async () => {
    expect(dateZoneFindings(await committed(columns))).toEqual([]);
    const planted = await rolledBack(async (client) => {
      await client.query('CREATE TABLE public.pickup_probe (id uuid PRIMARY KEY, pickup_date date NOT NULL)');
      await client.query(`CREATE TABLE public.zoned_probe (id uuid PRIMARY KEY, pickup_date date NOT NULL, time_zone text NOT NULL)`);
      await client.query(`CREATE TABLE public.holiday_probe (id uuid PRIMARY KEY, local_date date NOT NULL, hub_time_zone text NOT NULL)`);
      await client.query(`CREATE TABLE public.wrongtype_probe (id uuid PRIMARY KEY, due_date date NOT NULL, time_zone varchar NOT NULL)`);
      return columns(client);
    });
    expect(dateZoneFindings(planted)).toEqual([
      'pickup_probe.pickup_date: date without an IANA time-zone column',
      'wrongtype_probe.due_date: date without an IANA time-zone column',
    ]);
    // An exemption silences exactly the named column, and nothing else.
    expect(dateZoneFindings(planted, { 'pickup_probe.pickup_date': 'test-only reason' })).toEqual([
      'wrongtype_probe.due_date: date without an IANA time-zone column',
    ]);
  }, 60_000);

  it('AT-US-064-01 (schema) / NFR-DATA-003: every public base table has the standard columns, server-set actors and a version CHECK; the exemption map is explicit', async () => {
    expect(standardColumnFindings(await committed(standardInput))).toEqual([]);
    const planted = await rolledBack(async (client) => {
      await client.query(standardTable('std_ok'));
      await client.query(standardTable('std_no_version', { version: null }));
      await client.query(
        standardTable('std_actor_default', { created_by: `created_by uuid NOT NULL DEFAULT '00000000-0000-7000-8000-000000000001'` }),
      );
      await client.query(standardTable('std_no_check', { version: 'version integer NOT NULL DEFAULT 1' }));
      await client.query(standardTable('std_bigserial', { id: 'id bigserial PRIMARY KEY' }, null));
      await client.query(standardTable('std_composite_pk', {}, 'PRIMARY KEY (id, created_at)'));
      await client.query(`CREATE TABLE public.std_part (id uuid NOT NULL DEFAULT uuidv7(), created_at timestamptz NOT NULL DEFAULT now(),
                            updated_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, updated_by uuid NOT NULL,
                            version integer NOT NULL DEFAULT 1 CHECK (version >= 1)) PARTITION BY RANGE (created_at)`);
      await client.query(`CREATE TABLE public.std_part_p1 PARTITION OF public.std_part FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')`);
      // An append-only row keeps version = 1 (data-model P2): that CHECK is accepted too.
      await client.query(standardTable('std_version_one', { version: 'version integer NOT NULL DEFAULT 1 CHECK (version = 1)' }));
      return standardColumnFindings(await standardInput(client));
    });
    expect(planted).toEqual(
      [
        'std_actor_default.created_by: server-set column must not have a DEFAULT',
        'std_bigserial.id: DEFAULT is not uuidv7()',
        'std_bigserial.id: type is int8, expected uuid',
        'std_composite_pk.id: primary key is (created_at, id), expected (id) alone',
        'std_no_check.version: missing CHECK (version >= 1)',
        'std_no_version: missing version',
        'std_part.id: primary key is (none), expected (id) alone',
      ].sort(),
    );
  }, 60_000);

  it('NFR-DATA-003 OI-08: the append-only family needs only a timestamptz NOT NULL creation column (rule on catalogue rows)', () => {
    // Planted as catalogue rows, not DDL: the audit identity DDL guard (TASK-021) refuses migrator DDL on audit_* names.
    const column = (table: string, name: string, type: string, notNull = true, def: string | null = null): ColumnRow => ({
      schema_name: 'public',
      table_name: table,
      column_name: name,
      type_name: type,
      not_null: notNull,
      default_expr: def,
      identity: '',
    });
    const columns = [
      column('audit_entries', 'id', 'uuid'),
      column('audit_entries', 'occurred_at', 'timestamptz'),
      column('audit_anchors', 'anchor_seq', 'int8'),
      column('audit_anchors', 'created_at', 'timestamptz'),
      column('audit_pii_vault', 'token', 'uuid', true, 'uuidv7()'),
      column('audit_pii_vault', 'created_at', 'timestamp'),
      column('processed_events', 'id', 'uuid'),
      column('processed_events', 'occurred_at', 'timestamptz', false),
      column('audit_partitions', 'id', 'uuid', true, 'uuidv7()'),
    ];
    const primaryKeys = [{ table_name: 'audit_entries', pk_columns: ['id', 'occurred_at'] }];
    expect(standardColumnFindings({ columns, primaryKeys, checks: [] })).toEqual(
      [
        // audit_partitions is not append-only: the full contract applies to it.
        'audit_partitions: missing created_at',
        'audit_partitions: missing created_by',
        'audit_partitions: missing updated_at',
        'audit_partitions: missing updated_by',
        'audit_partitions: missing version',
        'audit_partitions.id: primary key is (none), expected (id) alone',
        'audit_pii_vault: missing created_at or occurred_at timestamptz NOT NULL',
        'processed_events: missing created_at or occurred_at timestamptz NOT NULL',
      ].sort(),
    );
  });

  it('NFR-DATA-003: the exemptions are exactly the migration ledgers; both exist in the catalogue and nothing else is exempt', async () => {
    expect(Object.keys(STANDARD_COLUMNS_EXEMPT).sort()).toEqual(['_prisma_migrations', 'bootstrap_migrations']);
    for (const reason of Object.values(STANDARD_COLUMNS_EXEMPT)) expect(reason.length).toBeGreaterThan(10);
    const tables = new Set((await committed(publicColumns)).map((c) => c.table_name));
    expect([...tables]).toEqual(expect.arrayContaining(['_prisma_migrations', 'bootstrap_migrations']));
    // Without the exemption map the ledgers are reported, so the map (not luck) keeps the committed run green.
    const unexempted = standardColumnFindings(await committed(standardInput), {});
    expect(unexempted.some((f) => f.startsWith('_prisma_migrations'))).toBe(true);
    expect(unexempted.some((f) => f.startsWith('bootstrap_migrations'))).toBe(true);
  }, 60_000);

  it('NFR-DATA-002: no serial, identity or sequence-default column in public (planted control)', async () => {
    expect(sequenceKeyFindings(await committed(publicColumns))).toEqual([]);
    const planted = await rolledBack(async (client) => {
      await client.query('CREATE TABLE public.seq_serial (id bigserial PRIMARY KEY)');
      await client.query('CREATE TABLE public.seq_identity (id uuid PRIMARY KEY, n bigint GENERATED ALWAYS AS IDENTITY)');
      await client.query('CREATE TABLE public.seq_identity_default (id uuid PRIMARY KEY, n integer GENERATED BY DEFAULT AS IDENTITY)');
      return sequenceKeyFindings(await publicColumns(client));
    });
    expect(planted).toEqual([
      'seq_identity.n: identity column',
      'seq_identity_default.n: identity column',
      'seq_serial.id: sequence default',
    ]);
  }, 60_000);

  it('REQ-ORG-007 / OI-24: every on_behalf_of_org_id is uuid, nullable and pinned NULL by a CHECK in M1 (planted control)', async () => {
    // No business table carries the column yet; the check binds every future migration that adds it.
    expect(onBehalfFindings(await committed((client) => rows<OnBehalfRow>(client, ON_BEHALF_SQL)))).toEqual([]);
    // The audit copy of the column is exempt by name only (it records the audited row's value, REQ-ORG-007).
    const auditCopy: OnBehalfRow = { schema_name: 'public', table_name: 'audit_entries', type_name: 'uuid', not_null: false, checks: [] };
    expect(onBehalfFindings([auditCopy])).toEqual([]);
    expect(onBehalfFindings([auditCopy], {})).toHaveLength(1);
    expect(onBehalfFindings([{ ...auditCopy, schema_name: 'platform' }])).toHaveLength(1);
    const planted = await rolledBack(async (client) => {
      await client.query('CREATE TABLE public.ob_no_check (id uuid PRIMARY KEY, on_behalf_of_org_id uuid)');
      await client.query(`CREATE TABLE public.ob_ok (id uuid PRIMARY KEY, on_behalf_of_org_id uuid,
                            CONSTRAINT ck_ob_ok__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NULL))`);
      await client.query(`CREATE TABLE public.ob_text (id uuid PRIMARY KEY, on_behalf_of_org_id text,
                            CONSTRAINT ck_ob_text__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NULL))`);
      await client.query(`CREATE TABLE public.ob_not_null (id uuid PRIMARY KEY, on_behalf_of_org_id uuid NOT NULL,
                            CONSTRAINT ck_ob_not_null__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NULL))`);
      await client.query(`CREATE TABLE public.ob_wrong_check (id uuid PRIMARY KEY, on_behalf_of_org_id uuid,
                            CONSTRAINT ck_ob_wrong_check__on_behalf_null_m1 CHECK (on_behalf_of_org_id IS NOT NULL))`);
      return onBehalfFindings(await rows<OnBehalfRow>(client, ON_BEHALF_SQL));
    });
    expect(planted).toEqual([
      'ob_no_check.on_behalf_of_org_id: missing CHECK (on_behalf_of_org_id IS NULL), expected ck_ob_no_check__on_behalf_null_m1',
      'ob_not_null.on_behalf_of_org_id: must be nullable',
      'ob_text.on_behalf_of_org_id: type is text, expected uuid',
      'ob_wrong_check.on_behalf_of_org_id: missing CHECK (on_behalf_of_org_id IS NULL), expected ck_ob_wrong_check__on_behalf_null_m1',
    ]);
  }, 60_000);
});
