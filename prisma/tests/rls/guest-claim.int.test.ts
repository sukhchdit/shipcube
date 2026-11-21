/**
 * Guest-row binding, the owner-scoped unique keys and the atomic claim on PostgreSQL 18 (TASK-051; US-080,
 * REQ-RLS-013, NFR-TENANT-001; rulings/wave-1-r-arch-34-operator-rulings.md §2.3, §2.4, §2.7, §8.4 and §8.5;
 * data-model §3.10, §4.3, §4.7 as amended 2026-11-19 and 2026-11-21; ADR-0005 amendment 10 items 11 and 15, amendment
 * 14 items 31 to 33, amendment 15 item 37; D-ARCH-065, D-ARCH-162, D-ARCH-163, D-ARCH-210, D-ARCH-211; PR7-SEC-04,
 * PR7-SEC-12 (d), PR7-SEC-13).
 *
 * The four GUEST_CAPABLE probe tables (`gc_*`, prisma/tests/harness/guest-claim-probe.ts) are planted in a throw-away
 * clone of the migrated template as `platform_migrator`, with the RLS block of renderRls and the de-claim trigger over
 * the migrated `platform.guest_capable_guard()`. Seed rows go in committed as the superuser. Every case runs in its own
 * transaction that is rolled back; the cases of rulings §2.7 and the US-080 database halves run as `platform_app` with
 * the production context statement (CONTEXT_STATEMENT_SQL), the de-claim transitions as the superuser (RLS bypassed,
 * the trigger alone answers). An observation that differs from rulings §2.7 goes back to principal-architect; the
 * expectations here are not adapted to it. One such observation is ruled (D-ARCH-211): on PostgreSQL 18 a refused
 * RESTRICT action (a key of the quote changes while a row still names it: C2, C6) is SQLSTATE 23001
 * (restrict_violation), where 17.5 answered 23503; a row that names a missing parent stays 23503 (C3, G1-G4, T1-T3).
 *
 * HTTP halves owed elsewhere: getQuote (TASK-087/091) for AT-US-080-01/02, claimQuote (TASK-146) for 04 to 07.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { expectAffected } from '../../../apps/api/src/platform/db/expect-affected.js';
import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import { loadTableClasses } from '../../../tools/db/table-classes.js';
import {
  ANONYMOUS_ACTOR,
  CLAIM_SQL,
  GC_CHILDREN,
  GC_TABLES,
  INSERT_PACKAGE_SQL,
  INSERT_QUOTE_SQL,
  INSERT_REQUOTE_SQL,
  INSERT_SHARE_SQL,
  asApp,
  childClaimSql,
  claimContext,
  claimSql,
  guestContext,
  newGuestHash,
  orgContext,
  outcome,
  plantGuestClaimProbe,
  seedQuote,
  type GcTable,
  type GuestHash,
  type ProbeContext,
  type SeededQuote,
} from '../harness/guest-claim-probe.js';
import { PlatformPostgres } from '../harness/postgres.js';

interface World {
  readonly orgA: string;
  readonly orgB: string;
  readonly userA: string;
  readonly userB: string;
  readonly h1: GuestHash;
  readonly h2: GuestHash;
  /** Organisation A's quote with one row in each child table. */
  readonly qa: SeededQuote;
  /** A second quote of A without children (S4). */
  readonly qa2: SeededQuote;
  readonly qb: SeededQuote;
  /** Guest H1's quote with one row in each child table: the quote the claim cases claim. */
  readonly qh1: SeededQuote;
  /** A second quote of H1 without children (S4, guest). */
  readonly qh1Bare: SeededQuote;
  readonly qh2: SeededQuote;
}

let db: PlatformPostgres;
let session: pg.Client;
let w: World;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  const database = await db.clone(await db.template({ migrated: true }));
  const migrator = new pg.Client(db.migratorConnection(database));
  await migrator.connect();
  try {
    await plantGuestClaimProbe(migrator);
  } finally {
    await migrator.end();
  }
  session = await db.superuser(database);
  const orgA = randomUUID();
  const orgB = randomUUID();
  const h1 = newGuestHash();
  const h2 = newGuestHash();
  w = {
    orgA,
    orgB,
    userA: randomUUID(),
    userB: randomUUID(),
    h1,
    h2,
    qa: await seedQuote(session, { org: orgA }),
    qa2: await seedQuote(session, { org: orgA }, false),
    qb: await seedQuote(session, { org: orgB }),
    qh1: await seedQuote(session, { guest: h1 }),
    qh1Bare: await seedQuote(session, { guest: h1 }, false),
    qh2: await seedQuote(session, { guest: h2 }),
  };
}, 300_000);

afterAll(async () => {
  await session?.end();
  await db?.stop();
}, 60_000);

/** Runs `fn` on the shared superuser session inside a transaction that is always rolled back. */
async function rolledBack<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  await session.query('BEGIN');
  try {
    return await fn(session);
  } finally {
    await session.query('ROLLBACK');
  }
}

/** `outcome` of one statement as `platform_app` under `ctx`, rolled back. */
const asAppOutcome = (ctx: ProbeContext, sql: string, params: readonly unknown[]): Promise<string> =>
  rolledBack(async (client) => {
    await asApp(client, ctx);
    return outcome(client, sql, params);
  });

const sqlState = (observed: string): string => observed.split(' ')[0] ?? '';
const affected = (result: pg.QueryResult): number => result.rowCount ?? -1;
const ROW_KEY: Readonly<Record<GcTable, keyof SeededQuote>> = {
  gc_quotes: 'quote',
  gc_quote_packages: 'package',
  gc_quote_options: 'option',
  gc_quote_shares: 'share',
};

/** Rows of `quote` visible to the current role and context, per table. */
async function visible(client: pg.ClientBase, quote: SeededQuote): Promise<Record<GcTable, number>> {
  const counts = {} as Record<GcTable, number>;
  for (const table of GC_TABLES) {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE id = $1::uuid`, [
      quote[ROW_KEY[table]],
    ]);
    counts[table] = rows[0]?.n ?? -1;
  }
  return counts;
}

/** Owner columns of every row of `quote`, read as the superuser (RLS bypassed). */
async function owners(client: pg.ClientBase, quote: SeededQuote): Promise<Record<GcTable, [string | null, string | null]>> {
  await client.query('RESET ROLE');
  const result = {} as Record<GcTable, [string | null, string | null]>;
  for (const table of GC_TABLES) {
    const { rows } = await client.query<{ org_id: string | null; hash: string | null }>(
      `SELECT org_id, encode(guest_token_hash, 'hex') AS hash FROM public.${table} WHERE id = $1::uuid`,
      [quote[ROW_KEY[table]]],
    );
    result[table] = [rows[0]?.org_id ?? null, rows[0]?.hash ?? null];
  }
  return result;
}

/**
 * SYSTEM tables whose org_id may be NULL, with the reason (AT-US-080-03). SYSTEM tables carry no RLS and are read only
 * through their own package, so a NULL org_id there binds no row to a guest.
 */
const NULLABLE_ORG_ID_SYSTEM: ReadonlyMap<string, string> = new Map([
  [
    'audit_entries',
    'the audit store (ADR-0007; prisma/bootstrap/10-audit.sql): an entry of a system or guest action names no organisation; its partitions inherit the column',
  ],
]);

const each = <T>(value: T): Record<GcTable, T> => Object.fromEntries(GC_TABLES.map((table) => [table, value])) as Record<GcTable, T>;
const ALL_VISIBLE = each(1);
const NONE_VISIBLE = each(0);

/** The DbError `expectAffected` raises, or undefined. */
function affectedError(count: number): DbError | undefined {
  try {
    expectAffected(count, 1);
    return undefined;
  } catch (error) {
    if (error instanceof DbError) return error;
    throw error;
  }
}

describe('guest-claim probe schema (migration 20261120200000_guest_capable_guard; D-ARCH-065)', () => {
  it('[D-ARCH-065] [PR7-SEC-04] the migrated platform.guest_capable_guard() is owned by platform_migrator, not SECURITY DEFINER, with the fixed search path; every gc_ table fires it BEFORE UPDATE', async () => {
    const observed = await rolledBack(async (client) => {
      const fn = await client.query<{ owner: string; prosecdef: boolean; proconfig: string[] | null }>(
        `SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
           FROM pg_catalog.pg_proc p WHERE p.oid = 'platform.guest_capable_guard()'::regprocedure`,
      );
      const triggers = await client.query<{ tgname: string }>(
        `SELECT t.tgname::text AS tgname FROM pg_catalog.pg_trigger t
          WHERE t.tgfoid = 'platform.guest_capable_guard()'::regprocedure AND t.tgenabled = 'O' AND NOT t.tgisinternal
          ORDER BY 1`,
      );
      return { fn: fn.rows, triggers: triggers.rows.map((row) => row.tgname) };
    });
    expect(observed.fn).toHaveLength(1);
    expect(observed.fn[0]?.owner).toBe('platform_migrator');
    expect(observed.fn[0]?.prosecdef).toBe(false);
    expect(observed.fn[0]?.proconfig).toEqual([expect.stringMatching(/^search_path=pg_catalog, ?pg_temp$/)]);
    expect(observed.triggers).toEqual(GC_TABLES.map((table) => `tg_${table}__guest_capable_guard`).sort());
  });
});

describe('rulings §2.7 guest binding as platform_app (SEC-TC-76; D-ARCH-162, D-ARCH-163)', () => {
  const guestH1 = (): ProbeContext => guestContext(w.h1);
  const orgA = (): ProbeContext => orgContext(w.orgA, w.userA);
  const pkg = (org: string | null, guest: GuestHash | null, quote: string, seq: number, actor = ANONYMOUS_ACTOR): unknown[] => [
    randomUUID(),
    org,
    guest?.bytes ?? null,
    quote,
    seq,
    actor,
  ];
  const share = (org: string | null, guest: GuestHash | null, quote: string, actor = ANONYMOUS_ACTOR): unknown[] => [
    randomUUID(),
    org,
    guest?.bytes ?? null,
    quote,
    randomBytes(32),
    actor,
  ];
  const GUEST_KEY = '23503 fk_gc_quote_packages__guest_token_hash_quote_id';
  const ORG_KEY = '23503 fk_gc_quote_packages__org_id_quote_id';

  it.each([
    ['G1', "a package naming H2's quote, a seq H2 holds", () => pkg(null, w.h1, w.qh2.quote, 1), GUEST_KEY],
    ['G2', "a package naming H2's quote, a free seq", () => pkg(null, w.h1, w.qh2.quote, 2), GUEST_KEY],
    ['G3', 'a package naming a quote of organisation A', () => pkg(null, w.h1, w.qa.quote, 1), GUEST_KEY],
    ['G4', 'a package naming an unknown id', () => pkg(null, w.h1, randomUUID(), 1), GUEST_KEY],
    ['G5', 'its own package, a free seq', () => pkg(null, w.h1, w.qh1.quote, 2), 'ok'],
    ['G6', 'its own package, a duplicate seq', () => pkg(null, w.h1, w.qh1.quote, 1), '23505 ux_gc_quote_packages__guest_quote_seq'],
  ] as const)('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] %s guest H1: %s -> %s', async (_id, _what, params, expected) => {
    expect(await asAppOutcome(guestH1(), INSERT_PACKAGE_SQL, params())).toBe(expected);
  });

  it("[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] G7 guest H1: a guest row carrying H2's hash -> 42501 (row security WITH CHECK)", async () => {
    expect(sqlState(await asAppOutcome(guestH1(), INSERT_PACKAGE_SQL, pkg(null, w.h2, w.qh2.quote, 2)))).toBe('42501');
  });

  it.each([
    ['T1', "a package naming B's quote, a seq B holds", () => pkg(w.orgA, null, w.qb.quote, 1, w.userA), ORG_KEY],
    ['T2', 'a package naming a guest quote', () => pkg(w.orgA, null, w.qh1.quote, 1, w.userA), ORG_KEY],
    ['T3', 'a package naming an unknown id', () => pkg(w.orgA, null, randomUUID(), 1, w.userA), ORG_KEY],
    ['T4', 'its own package, a free seq', () => pkg(w.orgA, null, w.qa.quote, 2, w.userA), 'ok'],
    [
      'T5',
      'its own package, a duplicate seq',
      () => pkg(w.orgA, null, w.qa.quote, 1, w.userA),
      '23505 ux_gc_quote_packages__org_quote_seq',
    ],
  ] as const)('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] %s organisation A: %s -> %s', async (_id, _what, params, expected) => {
    expect(await asAppOutcome(orgA(), INSERT_PACKAGE_SQL, params())).toBe(expected);
  });

  it.each([
    [
      'S1',
      "guest H1: an active share naming H2's quote, which has one",
      guestH1,
      () => share(null, w.h1, w.qh2.quote),
      '23503 fk_gc_quote_shares__guest_token_hash_quote_id',
    ],
    [
      'S2',
      "organisation A: an active share naming B's quote, which has one",
      orgA,
      () => share(w.orgA, null, w.qb.quote, w.userA),
      '23503 fk_gc_quote_shares__org_id_quote_id',
    ],
    [
      'S3',
      'organisation A: a second active share of its own quote',
      orgA,
      () => share(w.orgA, null, w.qa.quote, w.userA),
      '23505 ux_gc_quote_shares__org_quote_active',
    ],
    [
      'S3',
      'guest H1: a second active share of its own quote',
      guestH1,
      () => share(null, w.h1, w.qh1.quote),
      '23505 ux_gc_quote_shares__guest_quote_active',
    ],
    ['S4', 'organisation A: the first active share of its own quote', orgA, () => share(w.orgA, null, w.qa2.quote, w.userA), 'ok'],
    ['S4', 'guest H1: the first active share of its own quote', guestH1, () => share(null, w.h1, w.qh1Bare.quote), 'ok'],
  ] as const)('[SEC-TC-76] [SEC-TC-80] [D-ARCH-163] %s %s -> %s', async (_id, _what, ctx, params, expected) => {
    expect(await asAppOutcome(ctx(), INSERT_SHARE_SQL, params())).toBe(expected);
  });

  it.each([
    ['R1', 'organisation A re-quotes its own quote', () => [randomUUID(), w.orgA, null, w.qa.quote, w.userA], 'ok'],
    [
      'R2',
      "organisation A re-quotes B's quote",
      () => [randomUUID(), w.orgA, null, w.qb.quote, w.userA],
      '23503 fk_gc_quotes__requote_of_quote_id',
    ],
    [
      'R3',
      'organisation A re-quotes an unknown id',
      () => [randomUUID(), w.orgA, null, randomUUID(), w.userA],
      '23503 fk_gc_quotes__requote_of_quote_id',
    ],
  ] as const)('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] %s (T2-O) %s -> %s', async (_id, _what, params, expected) => {
    expect(await asAppOutcome(orgA(), INSERT_REQUOTE_SQL, params())).toBe(expected);
  });

  it('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] R4 (T2-O) a guest quote with a re-quote reference -> 23514 ck_gc_quotes__requote_org_only', async () => {
    const params = [randomUUID(), null, w.h1.bytes, w.qh1.quote, ANONYMOUS_ACTOR];
    expect(await asAppOutcome(guestH1(), INSERT_REQUOTE_SQL, params)).toBe('23514 ck_gc_quotes__requote_org_only');
  });
});

describe('rulings §2.3 / §2.7 the claim is one statement (SEC-TC-76; D-ARCH-162; PR7-SEC-13)', () => {
  const claimA = (): ProbeContext => claimContext(w.orgA, w.userA, w.h1);
  const params = (): unknown[] => [w.orgA, w.userA, w.qh1.quote];
  const UNCHANGED = (): Record<GcTable, [string | null, string | null]> => each([null, w.h1.hex]);

  it("[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] [PR7-SEC-04] C1 the claim of H1's quote by A, one statement with RESTRICT keys: 1 row through expectAffected; the quote, package, option and share now belong to A", async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimA());
      const count = expectAffected(affected(await client.query(CLAIM_SQL, params())), 1);
      const claim = await client.query<{ claimed_by: string; claimed_from: string }>(
        `SELECT claimed_by_user_id AS claimed_by, encode(claimed_from_token_hash, 'hex') AS claimed_from
           FROM public.gc_quotes WHERE id = $1::uuid`,
        [w.qh1.quote],
      );
      return { count, claim: claim.rows, owners: await owners(client, w.qh1) };
    });
    expect(observed).toEqual({ count: 1, claim: [{ claimed_by: w.userA, claimed_from: w.h1.hex }], owners: each([w.orgA, null]) });
  });

  it('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] [D-ARCH-211] C2 control: the quote first, then its children -> 23001 (restrict_violation, PostgreSQL 18) on the guest key of the packages', async () => {
    expect(await asAppOutcome(claimA(), claimSql([]), params())).toBe('23001 fk_gc_quote_packages__guest_token_hash_quote_id');
  });

  it('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] C3 control: the children first, then the quote -> 23503 on the organisation key of the packages', async () => {
    expect(await asAppOutcome(claimA(), childClaimSql('gc_quote_packages'), params())).toBe('23503 fk_gc_quote_packages__org_id_quote_id');
  });

  it("[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] [PR7-SEC-13] C4 the statement with H2's token for H1's quote: 0 rows, expectAffected raises NOT_FOUND, nothing changed", async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimContext(w.orgA, w.userA, w.h2));
      const error = affectedError(affected(await client.query(CLAIM_SQL, params())));
      return { error: error?.code, status: error?.status, owners: await owners(client, w.qh1) };
    });
    expect(observed).toEqual({ error: 'NOT_FOUND', status: 404, owners: UNCHANGED() });
  });

  it("[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] [PR7-SEC-13] C5 a second claim by B after A's: 0 rows, expectAffected raises NOT_FOUND, the rows stay A's", async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimA());
      const first = affected(await client.query(CLAIM_SQL, params()));
      await asApp(client, claimContext(w.orgB, w.userB, w.h1));
      const error = affectedError(affected(await client.query(CLAIM_SQL, [w.orgB, w.userB, w.qh1.quote])));
      return { first, error: error?.code, owners: await owners(client, w.qh1) };
    });
    expect(observed).toEqual({ first: 1, error: 'NOT_FOUND', owners: each([w.orgA, null]) });
  });

  it('[SEC-TC-76] [SEC-TC-80] [D-ARCH-162] [D-ARCH-211] C6 the statement without the quote_shares update -> 23001 (restrict_violation, PostgreSQL 18) on the guest key of the shares (no child stays behind)', async () => {
    const withoutShares = claimSql(GC_CHILDREN.filter((child) => child !== 'gc_quote_shares'));
    expect(await asAppOutcome(claimA(), withoutShares, params())).toBe('23001 fk_gc_quote_shares__guest_token_hash_quote_id');
  });
});

describe('ADR-0005 am. 10 item 11: the de-claim guard alone, as the superuser (PR7-SEC-04, PR7-SEC-12 (d); D-ARCH-065)', () => {
  const FORBIDDEN = '23514 GUEST_DECLAIM_FORBIDDEN';
  const transitions = [
    ['org -> NULL', 'SET org_id = NULL', (q: World) => q.qa, () => []],
    ['org A -> org B', 'SET org_id = $2::uuid', (q: World) => q.qa, () => [w.orgB]],
    ['NULL -> hash', 'SET guest_token_hash = $2::bytea', (q: World) => q.qa, () => [w.h1.bytes]],
    ['hash H1 -> H2', 'SET guest_token_hash = $2::bytea', (q: World) => q.qh1, () => [w.h2.bytes]],
  ] as const;
  const cases = GC_TABLES.flatMap((table) => transitions.map(([name, set, row, extra]) => [table, name, set, row, extra] as const));

  it.each(cases)(
    '[SEC-TC-80] [D-ARCH-065] [PR7-SEC-04] %s: %s is refused by the trigger with RLS bypassed',
    async (table, _name, set, row, extra) => {
      const observed = await rolledBack((client) =>
        outcome(client, `UPDATE public.${table} ${set} WHERE id = $1::uuid`, [row(w)[ROW_KEY[table]], ...extra()]),
      );
      expect(observed).toBe(FORBIDDEN);
    },
  );

  it('[SEC-TC-80] [D-ARCH-065] [PR7-SEC-12 (d)] the legitimate claim (NULL -> org, hash -> NULL) passes the trigger as the superuser too', async () => {
    const observed = await rolledBack(async (client) => {
      const count = affected(await client.query(CLAIM_SQL, [w.orgA, w.userA, w.qh1.quote]));
      return { count, owners: await owners(client, w.qh1) };
    });
    expect(observed).toEqual({ count: 1, owners: each([w.orgA, null]) });
  });
});

describe('US-080 scenarios, database halves (AT-US-080-01..07)', () => {
  it("[AT-US-080-01] (database half) the guest context reads its quote and the quote's children", async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, guestContext(w.h1));
      return visible(client, w.qh1);
    });
    expect(observed).toEqual(ALL_VISIBLE);
  });

  it.each([
    ['another guest (H2)', (): ProbeContext => guestContext(w.h2)],
    ['a guessed hash', (): ProbeContext => guestContext(newGuestHash())],
    ['another organisation (B)', (): ProbeContext => orgContext(w.orgB, w.userB)],
    ['organisation A with the empty guest binding', (): ProbeContext => orgContext(w.orgA, w.userA)],
    ['the empty context', (): ProbeContext => ({ org: '', actor: '', guestHash: '' })],
  ] as const)(
    "[AT-US-080-02] [SEC-TC-80] (database half) %s reads 0 rows of H1's quote and children (the route answers 404)",
    async (_who, ctx) => {
      const observed = await rolledBack(async (client) => {
        await asApp(client, ctx());
        return visible(client, w.qh1);
      });
      expect(observed).toEqual(NONE_VISIBLE);
    },
  );

  it('[AT-US-080-03] (database half) a nullable org_id exists only on flagged tables: GUEST_CAPABLE (the manifests and the gc_ probe tables) or a listed SYSTEM table; org_id is NOT NULL on every TENANT table; a GUEST_CAPABLE row needs exactly one owner', async () => {
    const classes = loadTableClasses();
    const ofClass = (name: string): string[] => classes.filter((entry) => entry.class === name).map((entry) => entry.name);
    const tenant = ofClass('TENANT');
    const observed = await rolledBack(async (client) => {
      // A partition is reported under the root of its partition tree (audit_entries_YYYY_MM under audit_entries).
      const columns = await client.query<{ table: string; root: string; not_null: boolean }>(
        `SELECT c.relname::text AS "table", a.attnotnull AS not_null,
                COALESCE((SELECT r.relname FROM pg_catalog.pg_class r WHERE r.oid = pg_catalog.pg_partition_root(c.oid)), c.relname)::text
                  AS root
           FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
          WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND a.attname = 'org_id' AND NOT a.attisdropped
          ORDER BY 1`,
      );
      const noOwner = await outcome(client, INSERT_QUOTE_SQL, [randomUUID(), null, null, ANONYMOUS_ACTOR]);
      const bothOwners = await outcome(client, INSERT_QUOTE_SQL, [randomUUID(), w.orgA, w.h1.bytes, ANONYMOUS_ACTOR]);
      return { columns: columns.rows, noOwner, bothOwners };
    });
    const inTenant = observed.columns.filter((row) => tenant.includes(row.table));
    expect(inTenant.filter((row) => !row.not_null)).toEqual([]);
    expect(inTenant.map((row) => row.table)).toEqual(expect.arrayContaining(['invitations', 'memberships']));
    // Every listed SYSTEM table is SYSTEM in its manifest, so the list cannot carry a TENANT, GUEST_CAPABLE, USER_OWNED or
    // GLOBAL table.
    expect([...NULLABLE_ORG_ID_SYSTEM.keys()].filter((name) => !ofClass('SYSTEM').includes(name))).toEqual([]);
    // The set of tables (partition roots) with a nullable org_id is exactly the flagged set: no TENANT, USER_OWNED,
    // GLOBAL, unlisted SYSTEM or unlisted table holds one, and every flagged table does.
    const nullable = [...new Set(observed.columns.filter((row) => !row.not_null).map((row) => row.root))].sort();
    const flagged = [...new Set([...ofClass('GUEST_CAPABLE'), ...GC_TABLES, ...NULLABLE_ORG_ID_SYSTEM.keys()])].sort();
    expect(nullable).toEqual(flagged);
    expect([observed.noOwner, observed.bothOwners]).toEqual(['23514 ck_gc_quotes__owner', '23514 ck_gc_quotes__owner']);
  });

  it('[AT-US-080-04] (database half) one statement sets org_id on the quote and every child; the token no longer reads them and organisation A does', async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimContext(w.orgA, w.userA, w.h1));
      const count = expectAffected(affected(await client.query(CLAIM_SQL, [w.orgA, w.userA, w.qh1.quote])), 1);
      await asApp(client, guestContext(w.h1));
      const asGuest = await visible(client, w.qh1);
      await asApp(client, orgContext(w.orgA, w.userA));
      return { count, asGuest, asOrg: await visible(client, w.qh1) };
    });
    expect(observed).toEqual({ count: 1, asGuest: NONE_VISIBLE, asOrg: ALL_VISIBLE });
  });

  it('[AT-US-080-05] [PR7-SEC-13] (database half) a second claim touches 0 rows and expectAffected raises NOT_FOUND (the service re-reads; 409 is TASK-146)', async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimContext(w.orgA, w.userA, w.h1));
      const first = affected(await client.query(CLAIM_SQL, [w.orgA, w.userA, w.qh1.quote]));
      const error = affectedError(affected(await client.query(CLAIM_SQL, [w.orgA, w.userA, w.qh1.quote])));
      return { first, error: error?.code };
    });
    expect(observed).toEqual({ first: 1, error: 'NOT_FOUND' });
  });

  it('[AT-US-080-06] [SEC-TC-80] (database half) a context with the guest hash and no organisation or actor cannot claim: 42501 WITH CHECK, nothing changed (D-TASK051-06)', async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, guestContext(w.h1));
      const claim = await outcome(client, CLAIM_SQL, [w.orgA, w.userA, w.qh1.quote]);
      return { state: sqlState(claim), owners: await owners(client, w.qh1) };
    });
    expect(observed).toEqual({ state: '42501', owners: each([null, w.h1.hex]) });
  });

  it('[AT-US-080-07] (database half) on PostgreSQL 18 the claim returns old.org_id NULL and new.org_id set: the change record of the claim audit entry', async () => {
    const observed = await rolledBack(async (client) => {
      await asApp(client, claimContext(w.orgA, w.userA, w.h1));
      const result = await client.query<{ old_org_id: string | null; new_org_id: string | null }>(
        claimSql(GC_CHILDREN, 'old.org_id AS old_org_id, new.org_id AS new_org_id'),
        [w.orgA, w.userA, w.qh1.quote],
      );
      return { count: expectAffected(affected(result), 1), rows: result.rows };
    });
    expect(observed).toEqual({ count: 1, rows: [{ old_org_id: null, new_org_id: w.orgA }] });
  });
});
