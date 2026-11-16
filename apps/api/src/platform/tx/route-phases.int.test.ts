/**
 * Route I/O phases against a real PostgreSQL 18 as `platform_app` (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4) and
 * (6); TASK-020 part 020-C (a), (e)): the `load` transaction is READ ONLY (a write fails with SQLSTATE 25006 and the
 * request never reaches `call` or `handler`), the `handler` transaction is read-write, and the T-83 runtime twin: with
 * the API test lanes' `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS` (1 000 ms), a route whose service in another file keeps
 * the transaction open across a Mock-latency carrier call fails, while the same route written with `call` passes.
 * TASK-020 part 020-D: a raw `COMMIT` sent from `load` is refused by the TenantDb guard before it reaches the server
 * (PR44-SEC-05), and the runtime-twin failure is pinned to the hold duration (020-C code review R1-n6).
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { createApp } from '../../app.js';
import { type AppDb, type AppTransactionClient, DbError } from '../db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../db/runtime.js';
import { EXPECTED_ROLE_SETTINGS } from '../db/session-integrity.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { createRuntimeLog } from '../runtime/log.js';
import { rateWhileHolding } from './tests/holding-service.js';
import { mockLatencyCarrier, TEST_LANE_TX_IDLE_TIMEOUT_MS } from './tests/runtime-twin.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
/** Above the idle bound, so only idle_in_transaction_session_timeout can end a held transaction (not Prisma's timeout). */
const TX_STATEMENT_TIMEOUT_MS = 5_000;
/** The Mock `latency` scenario: longer than the test lanes' idle-in-transaction bound. */
const CARRIER_LATENCY_MS = TEST_LANE_TX_IDLE_TIMEOUT_MS + 600;

/** Creates `platform_app` with the bootstrap role settings and returns its connection URL (as runner-activation.int). */
async function createAppRole(adminUrl: string): Promise<string> {
  const password = randomBytes(24).toString('hex');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
    for (const setting of EXPECTED_ROLE_SETTINGS) {
      const [name, value] = setting.split('=') as [string, string];
      await admin.query(`ALTER ROLE platform_app SET ${name} = ${name === 'search_path' ? value : `'${value}'`}`);
    }
    // A table platform_app may write, so that only the transaction's access mode can refuse the write.
    await admin.query('CREATE TABLE public.phase_probe (id integer PRIMARY KEY)');
    await admin.query('GRANT SELECT, INSERT ON public.phase_probe TO platform_app');
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.username = 'platform_app';
  url.password = password;
  return url.toString();
}

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: 4,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: TX_STATEMENT_TIMEOUT_MS,
    DB_TX_LOCK_TIMEOUT_MS: 1_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS,
  }) as unknown as Config;

const GUEST = { tenancy: 'guest', transaction: 'tenant', method: 'post' } as const;
const readOnlyOf = async (db: unknown): Promise<string> => {
  const rows = await (db as AppDb).$queryRaw<{ mode: string }[]>`SELECT current_setting('transaction_read_only') AS mode`;
  return rows[0]?.mode ?? 'unknown';
};

const ranPhases: string[] = [];
const writeInLoad = fixtureRoute({
  ...GUEST,
  operationId: 'probeLoadWrite',
  path: '/fixtures/load-write',
  load: async ({ db }) => {
    await (db as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (1)`;
    return 'unreachable';
  },
  call: () => {
    ranPhases.push('call');
    return 'unreachable';
  },
  handler: () => {
    ranPhases.push('handler');
    return { status: 200, body: {} };
  },
});
/** PR44-SEC-05 (020-D): a load that ends its read-only transaction, then writes in what would be autocommit. */
const commitInLoad = fixtureRoute({
  ...GUEST,
  operationId: 'probeLoadCommit',
  path: '/fixtures/load-commit',
  load: async ({ db }) => {
    await (db as AppDb).$executeRaw`COMMIT`;
    await (db as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (4)`;
    return 'unreachable';
  },
  call: () => {
    ranPhases.push('call');
    return 'unreachable';
  },
  handler: () => {
    ranPhases.push('handler');
    return { status: 200, body: {} };
  },
});
/**
 * PR54-SEC-01 (a) and (c), code review R1-M1 (PR #54): the same COMMIT behind a line comment ended by CR, and behind
 * an `E'…'` string continued across a newline (it keeps its escapes). Both texts commit on PostgreSQL 18 (the control
 * case below sends them directly); the guard must read them the same way.
 */
const LEXER_FORMS = [
  { path: '/fixtures/load-commit-cr', id: 5, send: (db: AppDb) => db.$executeRaw`SELECT 1 -- note\r; COMMIT; SELECT 2` },
  {
    path: '/fixtures/load-commit-continuation',
    id: 6,
    send: (db: AppDb) => db.$executeRaw`SELECT E'a'\n'\\' ; ' ; COMMIT ; SELECT ' -- '`,
  },
] as const;
/** The same texts as LEXER_FORMS, sent without the guard (PostgreSQL 18 control). */
const LEXER_FORM_TEXTS = ['SELECT 1 -- note\r; COMMIT; SELECT 2', "SELECT E'a'\n'\\' ; ' ; COMMIT ; SELECT ' -- '"] as const;
const lexerFormRoutes = LEXER_FORMS.map(({ path, id, send }) =>
  fixtureRoute({
    ...GUEST,
    operationId: `probeLoadCommit${String(id)}`,
    path,
    load: async ({ db }) => {
      await send(db as AppDb);
      await (db as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (${id})`;
      return 'unreachable';
    },
    call: () => {
      ranPhases.push('call');
      return 'unreachable';
    },
    handler: () => {
      ranPhases.push('handler');
      return { status: 200, body: {} };
    },
  }),
);
/** The session advisory-lock key of SESSION_FORMS (pg_locks: classid 0, objid = the key). */
const ADVISORY_KEY = 5454;
/**
 * PR54-SEC-02 (a), code review R1-m3 (PR #54): session state that outlives the transaction on the pooled backend, a
 * cursor declared WITH HOLD and a session advisory lock. Admitted, either would let the load finish and the call and
 * handler run; the control case below shows that PostgreSQL 18 keeps both after COMMIT.
 */
const SESSION_FORMS = [
  {
    path: '/fixtures/load-cursor-with-hold',
    id: 7,
    send: (db: AppDb) => db.$executeRaw`DECLARE leak CURSOR WITH HOLD FOR SELECT id FROM public.phase_probe`,
  },
  { path: '/fixtures/load-advisory-lock', id: 8, send: (db: AppDb) => db.$queryRaw`SELECT pg_advisory_lock(5454)` },
] as const;
const sessionFormRoutes = SESSION_FORMS.map(({ path, id, send }) =>
  fixtureRoute({
    ...GUEST,
    operationId: `probeLoadSession${String(id)}`,
    path,
    load: async ({ db }) => {
      await send(db as AppDb);
      return 'loaded';
    },
    call: () => {
      ranPhases.push('call');
      return 'called';
    },
    handler: () => {
      ranPhases.push('handler');
      return { status: 200, body: {} };
    },
  }),
);
const accessModes = fixtureRoute({
  ...GUEST,
  operationId: 'probeAccessModes',
  path: '/fixtures/access-modes',
  load: async ({ db }) => ({ load: await readOnlyOf(db) }),
  call: (_ctx, loaded) => loaded,
  handler: async ({ db }, { called }) => {
    await (db as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (2)`;
    return { status: 200, body: { ...called, handler: await readOnlyOf(db) } };
  },
});
const carrier = mockLatencyCarrier(CARRIER_LATENCY_MS);
/** The defect: the handler's service (another file) holds the write transaction across the carrier call. */
const holdsAcrossCall = fixtureRoute({
  ...GUEST,
  operationId: 'probeRateHolding',
  path: '/fixtures/rate-holding',
  handler: async ({ db }) => ({ status: 200, body: await rateWhileHolding(db as AppDb, carrier, 'shp-1') }),
});
/** R1-n6 control: the same holding service with a latency well below the idle-in-transaction bound. */
const briefCarrier = mockLatencyCarrier(TEST_LANE_TX_IDLE_TIMEOUT_MS / 10);
const holdsBriefly = fixtureRoute({
  ...GUEST,
  operationId: 'probeRateHoldingBrief',
  path: '/fixtures/rate-holding-brief',
  handler: async ({ db }) => ({ status: 200, body: await rateWhileHolding(db as AppDb, briefCarrier, 'shp-1') }),
});
/** The same route written with the phases: read in load, carrier in call, write transaction after it. */
const withCall = fixtureRoute({
  ...GUEST,
  operationId: 'probeRateWithCall',
  path: '/fixtures/rate-with-call',
  load: async ({ db }) => {
    await (db as AppDb).$queryRaw`SELECT 1`;
    return { shipmentId: 'shp-1' };
  },
  call: (ctx, loaded) => carrier.rate(loaded.shipmentId, ctx.signal),
  handler: async ({ db }, { called }) => {
    await (db as AppDb).$queryRaw`SELECT 1`;
    return { status: 200, body: called };
  },
});

describe('[D-ARCH-106] route I/O phases on PostgreSQL 18 as platform_app (TASK-020 part 020-C)', () => {
  let container: StartedPostgreSqlContainer;
  let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
  let server: Server;
  let base: string;
  const lines: string[] = [];
  const log = createRuntimeLog('api', {
    write: (line: string) => {
      lines.push(line);
      return true;
    },
  });

  beforeAll(async () => {
    delete process.env['PGOPTIONS'];
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    const appUrl = await createAppRole(container.getConnectionUri());
    runtime = databaseRuntimeFromConfig(configFor(appUrl), 'api', log);
    await runtime.startup();
    const app = createApp({
      health: [],
      modules: [
        {
          name: 'fixtures',
          routes: [
            writeInLoad,
            commitInLoad,
            ...lexerFormRoutes,
            ...sessionFormRoutes,
            accessModes,
            holdsAcrossCall,
            holdsBriefly,
            withCall,
          ],
        },
      ],
      tenantTx: runtime.tenantTx,
      logger: log,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (server as Server | undefined)?.close(() => resolve()) ?? resolve());
    for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
    await (container as StartedPostgreSqlContainer | undefined)?.stop();
  }, 60_000);

  it('[D-ARCH-106 (4)] a write in a readOnly tenant transaction fails with SQLSTATE 25006 (runner level)', async () => {
    const ctx = { orgId: '', actorId: '', actorScope: 'TENANT' as const, guestTokenHash: '', correlationId: 'corr-readonly-01' };
    const attempt = runtime.tenantTx.withTenantTx(
      ctx,
      async (db) => (db as unknown as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (3)`,
      {
        readOnly: true,
      },
    );
    await expect(attempt).rejects.toBeInstanceOf(DbError);
    await expect(attempt).rejects.toMatchObject({ sqlState: '25006' });
    // The same statement in a default transaction is allowed: the access mode alone refused it.
    await expect(
      runtime.tenantTx.withTenantTx(
        ctx,
        async (db) => (db as unknown as AppDb).$executeRaw`INSERT INTO public.phase_probe (id) VALUES (3)`,
      ),
    ).resolves.toBe(1);
  });

  it('[D-ARCH-106 (4)] a write in load is refused (25006): problem response, call and handler never run', async () => {
    const response = await fetch(`${base}/fixtures/load-write`, { method: 'POST' });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
    expect(await response.text()).not.toContain('25006');
    expect(ranPhases).toEqual([]);
    const logged = lines.filter((line) => line.includes('25006'));
    expect(logged.length).toBeGreaterThan(0);
  });

  it('[PR44-SEC-05] a raw COMMIT in load is refused before it reaches the server: no row is written, handler never runs', async () => {
    const response = await fetch(`${base}/fixtures/load-commit`, { method: 'POST' });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
    expect(ranPhases).toEqual([]);
    // Without the TenantDb statement guard the COMMIT ends the read-only transaction and the INSERT commits in autocommit.
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM public.phase_probe WHERE id = 4');
      expect(rows).toEqual([{ n: 0 }]);
    } finally {
      await admin.end();
    }
  });

  it.each(LEXER_FORMS.map(({ path, id }) => [path, id] as const))(
    '[PR54-SEC-01] %s: a COMMIT the old lexer missed is refused before the server: no row %i, handler never runs',
    async (path, id) => {
      const response = await fetch(`${base}${path}`, { method: 'POST' });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
      expect(ranPhases).toEqual([]);
      const admin = new pg.Client({ connectionString: container.getConnectionUri() });
      await admin.connect();
      try {
        const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM public.phase_probe WHERE id = $1', [id]);
        expect(rows).toEqual([{ n: 0 }]);
      } finally {
        await admin.end();
      }
    },
  );

  it('[PR54-SEC-01] control: PostgreSQL 18 executes the COMMIT in both texts (a row inserted before it survives ROLLBACK)', async () => {
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    try {
      for (const [index, text] of LEXER_FORM_TEXTS.entries()) {
        const id = 70 + index;
        await admin.query('BEGIN');
        await admin.query('INSERT INTO public.phase_probe (id) VALUES ($1)', [id]);
        await admin.query(text);
        await admin.query('ROLLBACK'); // a warning only: the COMMIT in the text already ended the transaction
        const { rows } = await admin.query<{ n: number }>('SELECT count(*)::int AS n FROM public.phase_probe WHERE id = $1', [id]);
        expect(rows).toEqual([{ n: 1 }]);
      }
    } finally {
      await admin.end();
    }
  });

  it.each(SESSION_FORMS.map(({ path }) => [path] as const))(
    '[PR54-SEC-02] %s: session state that outlives the transaction is refused before the server; call and handler never run',
    async (path) => {
      const response = await fetch(`${base}${path}`, { method: 'POST' });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
      expect(ranPhases).toEqual([]);
      const admin = new pg.Client({ connectionString: container.getConnectionUri() });
      await admin.connect();
      try {
        // A session advisory lock that reached the server would still be held by the pooled backend.
        const { rows } = await admin.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND objid = $1",
          [ADVISORY_KEY],
        );
        expect(rows).toEqual([{ n: 0 }]);
      } finally {
        await admin.end();
      }
    },
  );

  it('[PR54-SEC-02] control: PostgreSQL 18 keeps a WITH HOLD cursor and a session advisory lock after COMMIT', async () => {
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    const observer = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await observer.connect();
    try {
      await admin.query('BEGIN');
      await admin.query('DECLARE held CURSOR WITH HOLD FOR SELECT 1 AS v');
      await admin.query('SELECT pg_advisory_lock($1::bigint)', [ADVISORY_KEY]);
      await admin.query('COMMIT');
      expect((await admin.query<{ v: number }>('FETCH ALL FROM held')).rows).toEqual([{ v: 1 }]);
      const { rows } = await observer.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pg_catalog.pg_locks WHERE locktype = 'advisory' AND objid = $1 AND granted",
        [ADVISORY_KEY],
      );
      expect(rows).toEqual([{ n: 1 }]);
    } finally {
      await admin.query('CLOSE ALL');
      await admin.query('SELECT pg_advisory_unlock_all()');
      await Promise.all([admin.end(), observer.end()]);
    }
  });

  it('[D-ARCH-106 (4)] load runs read-only and handler read-write, each in its own transaction', async () => {
    const response = await fetch(`${base}/fixtures/access-modes`, { method: 'POST' });
    expect([response.status, await response.json()]).toEqual([200, { load: 'on', handler: 'off' }]);
  });

  it('[D-ARCH-106 (6)] runtime twin: a service in another file holding the transaction across a Mock latency call fails', async () => {
    const response = await fetch(`${base}/fixtures/rate-holding`, { method: 'POST' });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
    // R1-n6 (020-C code review): the failure is caused by the hold duration alone. The same service and route shape
    // with a carrier latency below the idle-in-transaction bound passes. (The 25P03 termination reaches the app as a
    // closed-connection Error, not as a DbError with a SQLSTATE, so the log line cannot carry it.)
    const control = await fetch(`${base}/fixtures/rate-holding-brief`, { method: 'POST' });
    expect([control.status, await control.json()]).toEqual([200, { amount: 500 }]);
  }, 30_000);

  it('[D-ARCH-106 (6)] runtime twin: the same route written with call passes (no transaction is open during the carrier call)', async () => {
    const response = await fetch(`${base}/fixtures/rate-with-call`, { method: 'POST' });
    expect([response.status, await response.json()]).toEqual([200, { amount: 500 }]);
  }, 30_000);
});
