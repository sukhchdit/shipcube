/**
 * Suite `rls-cross-tenant`, SEC-TC-07 (threat-model T-44, AC-12; US-080; TASK-051): the concurrent claim of a guest
 * quote. Two accounts hold the same guest token and claim at the same time with the one-statement claim of
 * rulings/wave-1-r-arch-34-operator-rulings.md §2.3. Exactly one claim touches the quote; the other waits on the row
 * lock, re-checks `org_id IS NULL` against the committed row and touches 0 rows, which expectAffected turns into
 * NOT_FOUND (the service re-reads and answers 409, TASK-146). Afterwards the quote and its children (options included)
 * are visible only to the winner, and the guest token reads nothing (the route answers 404).
 *
 * Two claimants of DIFFERENT organisations are refused by row security alone once the winner commits (neither policy
 * admits the claimed row). So the same race also runs for two users of ONE organisation and for one user twice (a
 * double submit; security review PR051-SEC-02 (a)): there the tenant policy admits the claimed row, and only the
 * predicate `org_id IS NULL` makes the loser touch 0 rows. The loser commits when its claim touched a row, as the
 * claim repository would, so the claim record shows what survives. A control runs the statement without the predicate
 * and shows the same round catching it (both claims touch the row; the provenance is overwritten).
 *
 * Runs on the GUEST_CAPABLE probe tables of prisma/tests/harness/guest-claim-probe.ts (planted in a throw-away clone of
 * the migrated template as `platform_migrator`), with two real `platform_app` connections and the production context
 * statement. Rows are committed (a race needs two transactions), so every round seeds a fresh guest quote.
 */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';

import { expectAffected } from '../../../apps/api/src/platform/db/expect-affected.js';
import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import {
  CLAIM_SQL,
  GC_TABLES,
  asApp,
  claimContext,
  guestContext,
  newGuestHash,
  orgContext,
  plantGuestClaimProbe,
  seedQuote,
  type GcTable,
  type GuestHash,
  type ProbeContext,
  type SeededQuote,
} from '../../../prisma/tests/harness/guest-claim-probe.js';
import { PlatformPostgres } from '../../../prisma/tests/harness/postgres.js';

/** Lock wait budget of the claim transactions (ms): long enough that the loser waits for the winner's COMMIT. */
const LOCK_TIMEOUT_MS = 10_000;
const ROUNDS = 5;

interface Claimant {
  readonly org: string;
  readonly user: string;
}

let db: PlatformPostgres;
let database: string;
let superuser: pg.Client;

beforeAll(async () => {
  db = await PlatformPostgres.start();
  database = await db.clone(await db.template({ migrated: true }));
  const migrator = new pg.Client(db.migratorConnection(database));
  await migrator.connect();
  try {
    await plantGuestClaimProbe(migrator);
  } finally {
    await migrator.end();
  }
  superuser = await db.superuser(database);
}, 300_000);

afterAll(async () => {
  await superuser?.end();
  await db?.stop();
}, 60_000);

async function appSession(): Promise<pg.Client> {
  const client = new pg.Client(db.appConnection(database));
  await client.connect();
  return client;
}

/** Opens a claim transaction of `claimant` with the token `guest` on a fresh platform_app connection. */
async function openClaim(claimant: Claimant, guest: GuestHash): Promise<pg.Client> {
  const client = await appSession();
  await client.query('BEGIN');
  await asApp(client, claimContext(claimant.org, claimant.user, guest), LOCK_TIMEOUT_MS);
  return client;
}

const ROW_KEY: Readonly<Record<GcTable, keyof SeededQuote>> = {
  gc_quotes: 'quote',
  gc_quote_packages: 'package',
  gc_quote_options: 'option',
  gc_quote_shares: 'share',
};

/** Rows of `quote` (and its children) `ctx` reads, per table, in a read-only transaction of its own. */
async function visibleTo(ctx: ProbeContext, quote: SeededQuote): Promise<Record<GcTable, number>> {
  const client = await appSession();
  try {
    await client.query('BEGIN READ ONLY');
    await asApp(client, ctx);
    const counts = {} as Record<GcTable, number>;
    for (const table of GC_TABLES) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${table} WHERE id = $1::uuid`, [
        quote[ROW_KEY[table]],
      ]);
      counts[table] = rows[0]?.n ?? -1;
    }
    await client.query('ROLLBACK');
    return counts;
  } finally {
    await client.end();
  }
}

/** Resolves once backend `pid` waits on a lock (pg_stat_activity), or throws after `budgetMs`. */
async function waitForLockWait(pid: number, budgetMs = 5_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const { rows } = await superuser.query<{ wait: string | null }>(
      'SELECT wait_event_type AS wait FROM pg_stat_activity WHERE pid = $1::int',
      [pid],
    );
    if (rows[0]?.wait === 'Lock') return;
    if (Date.now() > deadline) throw new Error(`backend ${String(pid)} did not wait on a lock within ${String(budgetMs)} ms`);
    await delay(25);
  }
}

/** The DbError code `expectAffected(count, 1)` raises, or 'ok'. */
function affectedCode(count: number): string {
  try {
    expectAffected(count, 1);
    return 'ok';
  } catch (error) {
    if (error instanceof DbError) return error.code;
    throw error;
  }
}

const each = (value: number): Record<GcTable, number> =>
  Object.fromEntries(GC_TABLES.map((table) => [table, value])) as Record<GcTable, number>;

/** The claim statement with every `AND org_id IS NULL` removed: the mutant the same-organisation round must catch. */
const CLAIM_WITHOUT_PREDICATE_SQL = CLAIM_SQL.replaceAll(' AND org_id IS NULL', '');

/** What the database holds for a claimed quote, read as the superuser. */
interface ClaimRecord {
  readonly org: string | null;
  readonly claimedBy: string | null;
  readonly claimedFrom: string | null;
}

async function claimRecord(quote: SeededQuote): Promise<ClaimRecord> {
  const { rows } = await superuser.query<ClaimRecord>(
    `SELECT org_id AS org, claimed_by_user_id AS "claimedBy", encode(claimed_from_token_hash, 'hex') AS "claimedFrom"
       FROM public.gc_quotes WHERE id = $1::uuid`,
    [quote.quote],
  );
  return rows[0] ?? { org: 'missing', claimedBy: 'missing', claimedFrom: 'missing' };
}

/**
 * `first` claims and holds its row locks; `second` claims with the same token and waits on the lock (asserted through
 * pg_stat_activity); `first` commits; `second` then commits when its claim touched a row (the repository's path when
 * expectAffected passes) and rolls back otherwise. Returns both expectAffected outcomes.
 */
async function sequencedRace(
  sql: string,
  [first, second]: readonly [Claimant, Claimant],
  guest: GuestHash,
  quote: SeededQuote,
): Promise<{ won: string; lost: string }> {
  const winner = await openClaim(first, guest);
  const loser = await openClaim(second, guest);
  try {
    const won = (await winner.query(sql, [first.org, first.user, quote.quote])).rowCount ?? -1;
    const { rows } = await loser.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pending = loser.query(sql, [second.org, second.user, quote.quote]);
    // Abandoned when the lock wait is not observed: the test then fails with its own message, not an unhandled rejection.
    pending.catch(() => undefined);
    await waitForLockWait(rows[0]?.pid ?? -1);
    await winner.query('COMMIT');
    const lost = affectedCode((await pending).rowCount ?? -1);
    await loser.query(lost === 'ok' ? 'COMMIT' : 'ROLLBACK');
    return { won: affectedCode(won), lost };
  } finally {
    await winner.end();
    await loser.end();
  }
}

describe('SEC-TC-07 concurrent claim of a guest quote (T-44, AC-12; D-ARCH-162; PR7-SEC-13)', () => {
  const a: Claimant = { org: randomUUID(), user: randomUUID() };
  const b: Claimant = { org: randomUUID(), user: randomUUID() };
  /** A second user of organisation A. */
  const a2: Claimant = { org: a.org, user: randomUUID() };

  it('[SEC-TC-07] [AT-US-080-05] A claims and holds the row; B claims with the same token and waits; after A commits B touches 0 rows (NOT_FOUND); the quote and its options are visible only to A and the token reads nothing', async () => {
    const guest = newGuestHash();
    const quote = await seedQuote(superuser, { guest });
    const first = await openClaim(a, guest);
    const second = await openClaim(b, guest);
    try {
      const won = (await first.query(CLAIM_SQL, [a.org, a.user, quote.quote])).rowCount ?? -1;
      const { rows } = await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pending = second.query(CLAIM_SQL, [b.org, b.user, quote.quote]);
      // Abandoned when the lock wait is not observed: the test then fails with its own message, not an unhandled rejection.
      pending.catch(() => undefined);
      await waitForLockWait(rows[0]?.pid ?? -1);
      await first.query('COMMIT');
      const lost = (await pending).rowCount ?? -1;
      await second.query('ROLLBACK');
      expect({ won: affectedCode(won), lost: affectedCode(lost) }).toEqual({ won: 'ok', lost: 'NOT_FOUND' });
    } finally {
      await first.end();
      await second.end();
    }
    expect({
      winner: await visibleTo(orgContext(a.org, a.user), quote),
      loser: await visibleTo(orgContext(b.org, b.user), quote),
      token: await visibleTo(guestContext(guest), quote),
    }).toEqual({ winner: each(1), loser: each(0), token: each(0) });
  });

  it(`[SEC-TC-07] ${String(ROUNDS)} rounds of two simultaneous claims: exactly one claim touches 1 row and the other 0; only the winner reads the quote and its options; the token reads nothing`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const guest = newGuestHash();
      const quote = await seedQuote(superuser, { guest });
      const claimants = [a, b] as const;
      const clients = [await openClaim(a, guest), await openClaim(b, guest)] as const;
      try {
        const runs = clients.map(async (client, index) => {
          const claimant = claimants[index] ?? a;
          const result = await client.query(CLAIM_SQL, [claimant.org, claimant.user, quote.quote]);
          return { index, count: result.rowCount ?? -1 };
        });
        // The run Promise.race does not return is awaited below; if the race rejects first, it is abandoned and must not
        // surface as an unhandled rejection.
        for (const run of runs) run.catch(() => undefined);
        // The first claim to return holds its row locks until COMMIT; the other cannot return before that.
        const first = await Promise.race(runs);
        await clients[first.index]?.query('COMMIT');
        const second = await runs[1 - first.index];
        await clients[second?.index ?? 0]?.query('ROLLBACK');
        expect([affectedCode(first.count), affectedCode(second?.count ?? -1)]).toEqual(['ok', 'NOT_FOUND']);
        const winner = claimants[first.index] ?? a;
        const loser = claimants[1 - first.index] ?? b;
        expect({
          winner: await visibleTo(orgContext(winner.org, winner.user), quote),
          loser: await visibleTo(orgContext(loser.org, loser.user), quote),
          token: await visibleTo(guestContext(guest), quote),
        }).toEqual({ winner: each(1), loser: each(0), token: each(0) });
      } finally {
        for (const client of clients) await client.end();
      }
    }
  });

  it.each([
    ['two users of organisation A', (): readonly [Claimant, Claimant] => [a, a2]],
    ['the same user of organisation A twice (a double submit)', (): readonly [Claimant, Claimant] => [a, a]],
  ] as const)(
    '[SEC-TC-07] [PR051-SEC-02] same organisation, %s: the first claim touches 1 row; the second waits, re-checks org_id IS NULL on the committed row and touches 0 (NOT_FOUND); the claim record keeps the winner and the token digest',
    async (_who, pair) => {
      const [winner] = pair();
      const guest = newGuestHash();
      const quote = await seedQuote(superuser, { guest });
      expect(await sequencedRace(CLAIM_SQL, pair(), guest, quote)).toEqual({ won: 'ok', lost: 'NOT_FOUND' });
      expect(await claimRecord(quote)).toEqual({ org: a.org, claimedBy: winner.user, claimedFrom: guest.hex });
      expect({
        organisation: await visibleTo(orgContext(a.org, a2.user), quote),
        token: await visibleTo(guestContext(guest), quote),
      }).toEqual({ organisation: each(1), token: each(0) });
    },
  );

  it('[SEC-TC-07] [PR051-SEC-02] control: without AND org_id IS NULL the same-organisation round lets both claims through and the second overwrites the provenance, so the round above detects the loss of the predicate', async () => {
    expect(CLAIM_WITHOUT_PREDICATE_SQL).not.toContain('org_id IS NULL');
    expect(CLAIM_SQL.split(' AND org_id IS NULL')).toHaveLength(5); // the quote and the three children
    const guest = newGuestHash();
    const quote = await seedQuote(superuser, { guest });
    expect(await sequencedRace(CLAIM_WITHOUT_PREDICATE_SQL, [a, a2], guest, quote)).toEqual({ won: 'ok', lost: 'ok' });
    expect(await claimRecord(quote)).toEqual({ org: a.org, claimedBy: a2.user, claimedFrom: null });
  });
});
