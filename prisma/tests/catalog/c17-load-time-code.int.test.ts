/**
 * Catalog C17 (load-time code) against the bootstrapped and migrated schema on PostgreSQL 18 (data-model §4.6 C17,
 * §8.6 second amendment; D-ARCH-235, D-ARCH-236, D-ARCH-237; PR034-SEC-01, PR034-SEC-05; TASK-034 fix cycle 3).
 *
 * A restore loads every row as a privileged role, and PostgreSQL evaluates a table CHECK, a domain CHECK, a generated
 * column and a partition key as the role that writes the row. C17: those expressions call IMMUTABLE pg_catalog routines
 * only (operators: pg_catalog routines), read from the stored expression trees; no range type outside an extension. The
 * query, the reviewed list and the finding rule are tools/db/load-time-code.ts, which the restore rehearsal's load-time
 * gate uses too. Every planted probe is created as the migrator where PostgreSQL lets it (the second actor of the
 * security record: a holder of the migrator credential), inside a transaction of the superuser session that is rolled
 * back, so the committed schema never changes.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import {
  LOAD_TIME_CODE_SQL,
  REVIEWED_NON_IMMUTABLE_BUILTINS,
  loadTimeCodeFindings,
  unusedReviewedBuiltins,
  type LoadTimeCodeRow,
  type LoadTimeFinding,
} from '../../../tools/db/load-time-code.js';
import { MIGRATOR, PlatformPostgres } from '../harness/postgres.js';

let db: PlatformPostgres;
let database: string;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
}, 300_000);

afterAll(async () => {
  await db?.stop();
}, 60_000);

const rows = async (client: pg.ClientBase): Promise<LoadTimeCodeRow[]> => (await client.query<LoadTimeCodeRow>(LOAD_TIME_CODE_SQL)).rows;

/** Runs `statements` as the migrator in a rolled-back transaction, then the C17 query as the superuser; returns its rows. */
async function planted(statements: readonly string[]): Promise<LoadTimeCodeRow[]> {
  const client = await db.superuser(database);
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${MIGRATOR}`);
    for (const statement of statements) await client.query(statement);
    await client.query('RESET ROLE');
    return await rows(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

/** Migration-style routines (PL/pgSQL is never inlined, so the stored tree keeps the call). */
const ROUTINE =
  'CREATE FUNCTION public.zz_c17_w(integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN $1 IS NOT NULL; END $$';
const KEY = 'CREATE FUNCTION public.zz_c17_k(integer) RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN $1; END $$';
const W = 'public.zz_c17_w(integer)';
const finding = (kind: string, object: string, reference: string, reason: string): LoadTimeFinding => ({ kind, object, reference, reason });

describe('catalog C17: load-time code (D-ARCH-236; PR034-SEC-01)', () => {
  it('[C17] committed: no load-time expression of the migrated schema calls anything but an IMMUTABLE pg_catalog routine, no range type outside an extension, and the reviewed list has no unused entry', async () => {
    const client = await db.superuser(database);
    try {
      const committed = await rows(client);
      expect(loadTimeCodeFindings(committed)).toEqual([]);
      expect(unusedReviewedBuiltins(committed)).toEqual([]);
      expect(REVIEWED_NON_IMMUTABLE_BUILTINS.size).toBe(0);
      // Not vacuous: the schema has load-time expressions (CHECKs of the migrations and the audit tables).
      const sites = await client.query<{ n: number }>(
        "SELECT pg_catalog.count(*)::integer AS n FROM pg_catalog.pg_constraint WHERE contype = 'c'",
      );
      expect(sites.rows[0]?.n).toBeGreaterThan(50);
    } finally {
      await client.end();
    }
  });

  /** [label, statements run as the migrator, the findings C17 must report]. */
  const PROBES: [string, string[], LoadTimeFinding[]][] = [
    [
      'a table CHECK that calls a migration-style routine',
      [ROUTINE, `CREATE TABLE public.zz_c17_t (n integer CONSTRAINT zz_c17_t_ck CHECK (public.zz_c17_w(n)))`],
      [finding('table check', 'public.zz_c17_t zz_c17_t_ck', W, 'not built in')],
    ],
    [
      'a domain CHECK',
      [ROUTINE, 'CREATE DOMAIN public.zz_c17_d AS integer CONSTRAINT zz_c17_d_ck CHECK (public.zz_c17_w(VALUE))'],
      [finding('domain check', 'public.zz_c17_d zz_c17_d_ck', W, 'not built in')],
    ],
    [
      'a STORED generated column through an IMMUTABLE wrapper of a writer',
      [
        'CREATE TABLE public.zz_c17_side (who text)',
        'CREATE FUNCTION public.zz_c17_writer() RETURNS void LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.zz_c17_side VALUES (current_user); END $$',
        'CREATE FUNCTION public.zz_c17_wrap(integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN PERFORM public.zz_c17_writer(); RETURN true; END $$',
        'CREATE TABLE public.zz_c17_t (n integer, g boolean GENERATED ALWAYS AS (public.zz_c17_wrap(n)) STORED)',
      ],
      [finding('generated column', 'public.zz_c17_t.g', 'public.zz_c17_wrap(integer)', 'not built in')],
    ],
    [
      'a partition-key expression',
      [KEY, 'CREATE TABLE public.zz_c17_p (n integer) PARTITION BY LIST ((public.zz_c17_k(n)))'],
      [finding('partition key', 'public.zz_c17_p', 'public.zz_c17_k(integer)', 'not built in')],
    ],
    [
      'a CHECK that runs a query string through pg_catalog.query_to_xml',
      [
        ROUTINE,
        "CREATE TABLE public.zz_c17_t (n integer CONSTRAINT zz_c17_t_ck CHECK (pg_catalog.query_to_xml('select public.zz_c17_w(1)', true, false, '') IS NOT NULL))",
      ],
      [finding('table check', 'public.zz_c17_t zz_c17_t_ck', 'query_to_xml(text,boolean,boolean,text)', 'not immutable')],
    ],
    [
      'a CHECK with pg_catalog.random()',
      ['CREATE TABLE public.zz_c17_t (n integer CONSTRAINT zz_c17_t_ck CHECK (pg_catalog.random() >= 0))'],
      [finding('table check', 'public.zz_c17_t zz_c17_t_ck', 'random()', 'not immutable')],
    ],
    [
      'a CHECK with a STABLE built-in call (date_trunc on timestamptz) and the cast ts::date',
      [
        "CREATE TABLE public.zz_c17_t (ts timestamptz CONSTRAINT zz_c17_t_ck CHECK (pg_catalog.date_trunc('day', ts) IS NOT NULL), CONSTRAINT zz_c17_t_cast CHECK (ts::date IS NOT NULL))",
      ],
      [
        finding('table check', 'public.zz_c17_t zz_c17_t_cast', 'date(timestamp with time zone)', 'not immutable'),
        finding('table check', 'public.zz_c17_t zz_c17_t_ck', 'date_trunc(text,timestamp with time zone)', 'not immutable'),
      ],
    ],
    [
      'a CHECK with a planted operator',
      [
        'CREATE FUNCTION public.zz_c17_eq(integer, integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN $1 = $2; END $$',
        'CREATE OPERATOR public.=== (LEFTARG = integer, RIGHTARG = integer, FUNCTION = public.zz_c17_eq)',
        'CREATE TABLE public.zz_c17_t (n integer CONSTRAINT zz_c17_t_ck CHECK (n OPERATOR(public.===) 1))',
      ],
      [finding('table check', 'public.zz_c17_t zz_c17_t_ck', 'public.zz_c17_eq(integer,integer)', 'not built in')],
    ],
    [
      'a range type (C17 b, D-ARCH-237)',
      ['CREATE TYPE public.zz_c17_r AS RANGE (subtype = integer)'],
      [finding('range type', 'public.zz_c17_r', 'public.zz_c17_r', 'range type outside an extension')],
    ],
    [
      'a CHECK added NOT VALID (and never validated)',
      [
        ROUTINE,
        'CREATE TABLE public.zz_c17_t (n integer)',
        'ALTER TABLE public.zz_c17_t ADD CONSTRAINT zz_c17_t_ck CHECK (public.zz_c17_w(n)) NOT VALID',
      ],
      [finding('table check', 'public.zz_c17_t zz_c17_t_ck', W, 'not built in')],
    ],
  ];

  it.each(PROBES)(
    '[C17] planted, rolled back, created as the migrator: %s is reported with its kind and reason',
    async (_label, statements, expected) => {
      expect(loadTimeCodeFindings(await planted(statements))).toEqual(expected);
    },
  );

  it('[C17] controls: a STABLE built-in operator (timestamptz + interval), a COALESCE generated column and DEFAULT platform.app_org_id() are not reported', async () => {
    const found = await planted([
      `CREATE TABLE public.zz_c17_t (
         ts timestamptz CONSTRAINT zz_c17_t_ck CHECK (ts + interval '1 day' > ts),
         n integer,
         g integer GENERATED ALWAYS AS (COALESCE(n, 0)) STORED,
         org_id uuid DEFAULT platform.app_org_id(),
         s text CONSTRAINT zz_c17_t_s CHECK (pg_catalog.octet_length(s) <= 10 AND s IS DISTINCT FROM 'x' AND (n, n) < (1, 2))
       )`,
    ]);
    expect(loadTimeCodeFindings(found)).toEqual([]);
  });

  it('[C17] PostgreSQL 18, a VIRTUAL generated column that calls a migration-style routine: the server refuses the statement (feature not supported) or C17 reports the column (D-TASK034-17)', async () => {
    let refused: string | undefined;
    let found: LoadTimeCodeRow[] = [];
    try {
      found = await planted([
        ROUTINE,
        'CREATE TABLE public.zz_c17_t (n integer, g boolean GENERATED ALWAYS AS (public.zz_c17_w(n)) VIRTUAL)',
      ]);
    } catch (error) {
      refused = (error as { code?: string }).code;
    }
    // PostgreSQL 18 refuses a user-defined function in a virtual generated column (0A000); should a later release accept
    // it, the column must be reported. Either way no restore evaluates a migration routine through it unseen.
    const outcome = refused === undefined ? { reported: loadTimeCodeFindings(found) } : { refused };
    expect([{ refused: '0A000' }, { reported: [finding('generated column', 'public.zz_c17_t.g', W, 'not built in')] }]).toContainEqual(
      outcome,
    );
  });
});
