/**
 * The `TenantDb` guard on the REAL Prisma 7.10 client runtime, without a database (PR #11 M1, PR11-SEC-01, PR #11 m5;
 * ADR-0005 am. 10 item 1). The generated client runs over a recording driver adapter (security probe P-A pattern):
 * every statement is logged with the queryable that ran it (`ROOT` for the adapter itself, `TXn` for the n-th
 * transaction), so the test proves both that every escape route of the probe is refused and that no statement runs
 * outside the business transaction while the callback runs.
 */
import { beforeAll, describe, expect, it } from '@jest/globals';

import { DbError } from '../../../apps/api/src/platform/db/map-db-error.js';
import { type TenantDb, TenantDbAccessError } from '../../../apps/api/src/platform/db/tenant-db.js';
import { CONTEXT_STATEMENT_SQL, createWithTenantTx, type TenantContext } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import type * as GeneratedClient from '../../generated/prisma/client.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

type Db = TenantDb<Prisma.TransactionClient>;
type Generated = typeof GeneratedClient;
/** Property read through the guard (`unknown`, so a refused or exposed member is just a value to the probe). */
const get = (value: unknown, key: PropertyKey): unknown => (value as Record<PropertyKey, unknown>)[key];

interface SqlQuery {
  readonly sql: string;
  readonly args: unknown[];
}
interface Statement {
  readonly conn: string;
  readonly sql: string;
}
/** Prisma driver-adapter column types used here (`ColumnTypeEnum`). */
const INT32 = 0;
const TEXT = 7;
const PREV_KEYS = ['org_id', 'actor_id', 'actor_scope', 'guest_token_hash'];

/** Result of one statement: the context statement returns its clean prior values; anything else returns no rows. */
function resultOf(query: SqlQuery): { columnNames: string[]; columnTypes: number[]; rows: unknown[][] } {
  if (query.sql === CONTEXT_STATEMENT_SQL)
    return { columnNames: PREV_KEYS, columnTypes: PREV_KEYS.map(() => TEXT), rows: [PREV_KEYS.map(() => null)] };
  if (query.sql.startsWith('SELECT 1 AS n')) return { columnNames: ['n'], columnTypes: [INT32], rows: [[1]] };
  return { columnNames: [], columnTypes: [], rows: [] };
}

/** A recording `SqlDriverAdapterFactory` (structural; Prisma 7.10 driver-adapter contract). */
function recordingAdapter(log: Statement[]) {
  let transactions = 0;
  const queryable = (conn: string) => ({
    provider: 'postgres' as const,
    adapterName: 'recording',
    queryRaw: (query: SqlQuery) => {
      log.push({ conn, sql: query.sql });
      return Promise.resolve(resultOf(query));
    },
    executeRaw: (query: SqlQuery) => {
      log.push({ conn, sql: query.sql });
      return Promise.resolve(0);
    },
  });
  const adapter = {
    ...queryable('ROOT'),
    executeScript: () => Promise.reject(new Error('executeScript is not used')),
    startTransaction: () => {
      transactions += 1;
      const conn = `TX${String(transactions)}`;
      log.push({ conn, sql: 'BEGIN' });
      return Promise.resolve({
        ...queryable(conn),
        options: { usePhantomQuery: false },
        commit: () => {
          log.push({ conn, sql: 'commit()' });
          return Promise.resolve();
        },
        rollback: () => {
          log.push({ conn, sql: 'rollback()' });
          return Promise.resolve();
        },
      });
    },
    dispose: () => Promise.resolve(),
  };
  return { provider: 'postgres' as const, adapterName: 'recording', connect: () => Promise.resolve(adapter) };
}

const CTX: TenantContext = {
  orgId: '0190f5a4-0000-7000-8000-000000000001',
  actorId: '0190f5a4-0000-7000-8000-000000000002',
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'tenant-db-real-client',
};

/** The escape routes of PR11-SEC-01 / probe P-A and the members the guard never exposes. */
const REFUSED: ReadonlyArray<readonly [string, (db: Db) => unknown]> = [
  ['$parent', (db) => get(db, '$parent')],
  ['$parent._originalClient', (db) => (get(db, '$parent') as Record<string, unknown>)['_originalClient']],
  ['_originalClient', (db) => get(db, '_originalClient')],
  ['constructor', (db) => get(db, 'constructor')],
  ['__proto__', (db) => get(db, '__proto__')],
  ['$transaction', (db) => get(db, '$transaction')],
  ['$queryRawUnsafe', (db) => get(db, '$queryRawUnsafe')],
  ['$executeRawUnsafe', (db) => get(db, '$executeRawUnsafe')],
  ['$queryRawTyped', (db) => get(db, '$queryRawTyped')],
  ['$extends', (db) => get(db, '$extends')],
  ['$connect', (db) => get(db, '$connect')],
  ['$disconnect', (db) => get(db, '$disconnect')],
  ['$on', (db) => get(db, '$on')],
  ['_createPrismaPromise', (db) => get(db, '_createPrismaPromise')],
  ['permission.$parent', (db) => get(db.permission, '$parent')],
  ['role.$parent._originalClient', (db) => (get(db.role, '$parent') as Record<string, unknown>)['_originalClient']],
  ['permission.constructor', (db) => get(db.permission, 'constructor')],
  ['permission.name', (db) => get(db.permission, 'name')],
  ['permission.findRaw', (db) => get(db.permission, 'findRaw')],
];

let generated: Generated;

beforeAll(async () => {
  // The tree lock may be held by the deps rebuild suites running in parallel (they regenerate the client).
  generated = await withFileLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
}, 120_000);

function setup(): { log: Statement[]; client: PrismaClient; runner: ReturnType<typeof createWithTenantTx<Prisma.TransactionClient>> } {
  const log: Statement[] = [];
  const options = { adapter: recordingAdapter(log) } as unknown as ConstructorParameters<typeof generated.PrismaClient>[0];
  const client = new generated.PrismaClient(options);
  const runner = createWithTenantTx<Prisma.TransactionClient>(
    client,
    { statementTimeoutMs: 5_000, lockTimeoutMs: 2_000, idleInTransactionTimeoutMs: 15_000, poolConnectionTimeoutMs: 5_000 },
    {
      onSecurityEvent: () => undefined,
      countSessionContextLeak: () => undefined,
      markNotReady: () => undefined,
      env: {},
      scopeClient: () => client,
    },
  );
  return { log, client, runner };
}

const outcome = (read: () => unknown): string => {
  try {
    return read() === undefined ? 'undefined' : 'exposed';
  } catch (error) {
    return error instanceof TenantDbAccessError ? 'refused' : (error as Error).message;
  }
};

describe('TenantDb on the real Prisma 7.10 runtime (PR #11 M1, PR11-SEC-01; recording driver adapter)', () => {
  it('PR11-SEC-01: every escape route is refused, the exposed surface works, and nothing runs outside the transaction', async () => {
    const { log, client, runner } = setup();
    // Positive control on a raw transaction client: the escape routes exist in this runtime (so "refused" below is
    // the guard's doing), and Prisma's own symbol keys (its private client symbol among them) are collected.
    const raw = await client.$transaction((tx) =>
      Promise.resolve({
        symbols: Object.getOwnPropertySymbols(tx),
        parent: outcome(() => get(tx, '$parent')),
        root: outcome(() => (get(tx.permission, '$parent') as Record<string, unknown>)['_originalClient']),
      }),
    );
    expect(raw).toMatchObject({ parent: 'exposed', root: 'exposed' });
    const rawSymbols = raw.symbols;
    expect(rawSymbols.length).toBeGreaterThan(0);
    const start = log.length;

    let kept: Db['permission'] | undefined;
    let keptFind: (() => unknown) | undefined;
    const seen = await runner.withTenantTx(CTX, async (db) => {
      const refused = REFUSED.map(([name, read]) => [name, outcome(() => read(db))]);
      const symbols = rawSymbols.map((symbol) => outcome(() => get(db, symbol)));
      const nonTagged = [
        () => db.$queryRaw(generated.Prisma.raw('SELECT 1')),
        () => db.$executeRaw(generated.Prisma.raw('SELECT 1')),
        () => db.$queryRaw(generated.Prisma.sql`SELECT ${1}`),
      ].map((call) => outcome(call));
      const surface = {
        ownKeys: Reflect.ownKeys(db),
        ownSymbols: Object.getOwnPropertySymbols(db).length,
        spread: Object.keys({ ...db }),
        descriptors: Object.keys(Object.getOwnPropertyDescriptors(db)),
        delegateKeys: Reflect.ownKeys(db.permission),
        hasParent: '$parent' in db || '$parent' in db.permission,
      };
      const rows = await db.permission.findMany({ take: 1 });
      const one = await db.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`;
      kept = db.permission;
      keptFind = get(db.permission, 'findMany') as () => unknown;
      return { refused, symbols, nonTagged, surface, rows, one };
    });

    expect(Object.fromEntries(seen.refused)).toEqual(Object.fromEntries(REFUSED.map(([name]) => [name, 'refused'])));
    expect(seen.symbols).toEqual(rawSymbols.map(() => 'undefined'));
    expect(seen.nonTagged).toEqual(['refused', 'refused', 'refused']);
    // One delegate per Prisma model (a new model is a deliberate change of this list) plus the two tagged raw calls and
    // the guard's own rollback-only latch (PR42-SEC-02; not a Prisma member).
    // referenceDatasetVersion (TASK-023's SYSTEM table) is NOT on TenantDb: SYSTEM models are reached only through
    // systemDelegates(tx) (PR19-SEC-01, D-ARCH-080; prisma/tests/rls/system-delegates.int.test.ts).
    const exposed = ['permission', 'role', 'rolePermission', '$queryRaw', '$executeRaw', 'markRollbackOnly'];
    expect([...seen.surface.ownKeys].sort()).toEqual([...exposed].sort());
    expect(seen.surface).toMatchObject({ ownSymbols: 0, hasParent: false });
    expect([...seen.surface.spread].sort()).toEqual([...exposed].sort());
    expect([...seen.surface.descriptors].sort()).toEqual([...exposed].sort());
    expect(seen.surface.delegateKeys).toEqual(expect.arrayContaining(['findMany', 'create', 'updateMany', 'count', 'fields']));
    expect(seen.surface.delegateKeys).not.toContain('$parent');
    expect(seen.rows).toEqual([]);
    expect(seen.one).toEqual([{ n: 1 }]);

    // The guarded transaction: BEGIN, the context statement, the two allowed calls, COMMIT, all on one connection.
    const guarded = log.slice(start);
    expect(guarded.map(({ conn }) => conn)).toEqual(guarded.map(() => 'TX2'));
    expect(guarded.map(({ sql }) => sql.slice(0, 24))).toEqual([
      'BEGIN',
      CONTEXT_STATEMENT_SQL.slice(0, 24),
      'SELECT "public"."permiss',
      'SELECT 1 AS n',
      'COMMIT',
      'commit()',
    ]);
    expect(guarded[1]?.sql).toBe(CONTEXT_STATEMENT_SQL);
    expect(log.filter(({ conn }) => conn === 'ROOT')).toEqual([]);

    // References kept past the transaction are dead.
    expect(() => kept?.findMany).toThrow(DbError);
    expect(() => kept?.findMany).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => keptFind?.()).toThrow('Database error: TENANT_TX_CLOSED');
    await client.$disconnect();
  });

  it('R2-M1 / PR11-SEC-12: operation results are lazy, expose no requestTransaction, run on TXn, and a result kept past commit is dead', async () => {
    const { log, client, runner } = setup();
    let late: Record<string, PromiseLike<unknown>> = {};
    const seen = await runner.withTenantTx(CTX, async (db) => {
      const results: Record<string, PromiseLike<unknown>> = {
        findMany: db.permission.findMany({ take: 1 }),
        deleteMany: db.role.deleteMany({ where: { id: CTX.orgId } }),
        queryRaw: db.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n`,
        executeRaw: db.$executeRaw`SELECT 2 AS executed`,
      };
      const lazyLog = log.map(({ sql }) => sql.slice(0, 12));
      // [R3-n4] a read of any member other than then/catch/finally throws (no fluent accessor reads as undefined).
      const readOf = (result: unknown, key: string): string => {
        try {
          return `read:${String(get(result, key))}`;
        } catch (error) {
          return error instanceof TenantDbAccessError ? 'refused' : 'other';
        }
      };
      const shapes = Object.fromEntries(
        Object.entries(results).map(([name, result]) => [
          name,
          {
            requestTransaction: readOf(result, 'requestTransaction'),
            inRequestTransaction: 'requestTransaction' in result,
            spec: readOf(result, 'spec'),
            keys: Reflect.ownKeys(result).map(String),
            proto: Object.getPrototypeOf(result) as unknown,
            tag: Object.prototype.toString.call(result),
          },
        ]),
      );
      const values = await Promise.all(Object.values(results));
      // Created inside the callback, never awaited there, kept past commit.
      late = {
        findMany: db.permission.findMany(),
        deleteMany: db.role.deleteMany({ where: { id: CTX.orgId } }),
        queryRaw: db.$queryRaw`SELECT 3 AS late`,
        executeRaw: db.$executeRaw`SELECT 4 AS late`,
      };
      return { lazyLog, shapes, values };
    });

    // Laziness: building four results sent nothing beyond BEGIN and the context statement.
    expect(seen.lazyLog).toEqual(['BEGIN', CONTEXT_STATEMENT_SQL.slice(0, 12)]);
    const keys = ['then', 'catch', 'finally', 'Symbol(Symbol.toStringTag)'];
    for (const shape of Object.values(seen.shapes)) {
      expect(shape).toEqual({
        requestTransaction: 'refused',
        inRequestTransaction: false,
        spec: 'refused',
        keys,
        proto: null,
        tag: '[object TenantDbResult]',
      });
    }
    expect(seen.values).toEqual([[], { count: 0 }, [{ n: 1 }], 0]);
    expect(log.map(({ conn }) => conn)).toEqual(log.map(() => 'TX1'));
    expect(log.map(({ sql }) => sql.slice(0, 24))).toEqual([
      'BEGIN',
      CONTEXT_STATEMENT_SQL.slice(0, 24),
      'SELECT "public"."permiss',
      'DELETE FROM "public"."ro',
      'SELECT 1 AS n',
      'SELECT 2 AS executed',
      'COMMIT',
      'commit()',
    ]);

    // A late await: TENANT_TX_CLOSED, and no statement on any connection.
    const committed = log.length;
    const lateOutcomes = await Promise.all(
      Object.values(late).map(async (result) => {
        try {
          await result;
          return 'resolved';
        } catch (error) {
          return error instanceof DbError ? error.message : String(error);
        }
      }),
    );
    expect(lateOutcomes).toEqual(Object.values(late).map(() => 'Database error: TENANT_TX_CLOSED'));
    expect(log.length).toBe(committed);
    expect(log.filter(({ conn }) => conn === 'ROOT')).toEqual([]);
    await client.$disconnect();
  });

  it('PR11-SEC-13, R2-n3, PR11-SEC-15 f: Sql-fragment values, a forged strings array and $queryRawTyped are refused before Prisma runs', async () => {
    const { log, client, runner } = setup();
    const injected = "1' OR '1' = '1' -- victim";
    const seen = await runner.withTenantTx(CTX, async (db) => {
      const P = generated.Prisma;
      const fragments: Record<string, unknown> = {
        'Prisma.raw(s)': P.raw(injected),
        'Prisma.sql`…`': P.sql`SELECT ${1}`,
        'Prisma.sql([s])': P.sql([injected]),
        'Prisma.join([1], s)': P.join([1], injected),
        'new Prisma.Sql([s], [])': new P.Sql([injected], []),
      };
      const asValue = Object.fromEntries(
        Object.entries(fragments).flatMap(([name, fragment]) => [
          [`$queryRaw ${name}`, outcome(() => db.$queryRaw`SELECT ${1}, ${fragment}`)],
          [`$executeRaw ${name}`, outcome(() => db.$executeRaw`SELECT ${fragment}`)],
        ]),
      );
      const query = get(db, '$queryRaw') as (...args: unknown[]) => unknown;
      const forged = outcome(() => query(Object.freeze(Object.assign([injected], { raw: [injected] }))));
      const typed = outcome(() => get(db, '$queryRawTyped'));
      const typedIn = '$queryRawTyped' in db;
      // Control: a list bound as an array is the supported shape.
      const listed = await db.$queryRaw<Array<{ n: number }>>`SELECT 1 AS n WHERE 1 = ANY(${[1, 2]}::int[])`;
      return { asValue, forged, typed, typedIn, listed };
    });

    expect(seen.asValue).toEqual(
      Object.fromEntries(
        ['Prisma.raw(s)', 'Prisma.sql`…`', 'Prisma.sql([s])', 'Prisma.join([1], s)', 'new Prisma.Sql([s], [])'].flatMap((name) => [
          [`$queryRaw ${name}`, 'refused'],
          [`$executeRaw ${name}`, 'refused'],
        ]),
      ),
    );
    expect(seen).toMatchObject({ forged: 'refused', typed: 'refused', typedIn: false, listed: [{ n: 1 }] });
    expect(log.map(({ conn }) => conn)).toEqual(log.map(() => 'TX1'));
    expect(log.map(({ sql }) => sql.slice(0, 24))).toEqual([
      'BEGIN',
      CONTEXT_STATEMENT_SQL.slice(0, 24),
      'SELECT 1 AS n WHERE 1 = ',
      'COMMIT',
      'commit()',
    ]);
    expect(log.some(({ sql }) => sql.includes('victim'))).toBe(false);
    await client.$disconnect();
  });
});
