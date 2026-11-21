/**
 * The keyset arguments of the list convention on PostgreSQL 18 (US-037 AT-US-037-01, -02, -05 and -10; NFR-PERF-006;
 * D-TASK045-03): `prismaListArgs` + `pageOf` through the generated `membership` delegate, queried as the runtime role
 * `platform_app` inside `withTenantTx` (built by `databaseRuntimeFromConfig`, as both entry points get it), exactly as a
 * repository will.
 *
 * The database is a bare PostgreSQL 18 container (as tenant-admission.int.test.ts): `platform_app` with the bootstrap
 * role settings, and a `memberships` table with the columns of the Prisma model, its keyset index and a tenant RLS
 * policy of the real schema's shape over the released RLS helpers (`org_id = platform.app_org_id()`, the transaction's
 * organisation; the table is owned by the superuser, so the policy binds `platform_app`). The suite needs only that table, so the migrated schema (foreign keys, lifecycle
 * triggers) is not built; the repository's `base` condition adds the organisation scope as a real repository does. The
 * planted `created_at` values share one millisecond and differ in microseconds, and ten of them are equal, so a cursor
 * that carried a JavaScript `Date` (milliseconds) would skip or repeat rows; the ground truth is the database's own
 * `ORDER BY created_at, id`. A boundary row that is deleted, or moved to another organisation (invisible under RLS),
 * between pages is 400 INVALID_CURSOR (R1-M1, PR045-SEC-02); filter values at the column bounds answer 200
 * (PR045-SEC-01 controls).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import type { AppDb, AppTransactionClient, Prisma } from '../db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../db/runtime.js';
import { EXPECTED_ROLE_SETTINGS } from '../db/session-integrity.js';
import type { TenantContext } from '../db/with-tenant-tx.js';
import type { Principal, RouteDescriptor, RouteRequestContext } from '../routing/define-route.js';
import { createRuntimeLog } from '../runtime/log.js';
import { TEST_LANE_TX_IDLE_TIMEOUT_MS } from '../tx/tests/runtime-twin.js';
import { createCursorCodec } from './cursor.js';
import { listQuerySchema, parseListQuery } from './list-query.js';
import { defineListSpec } from './list-spec.js';
import { pageOf } from './page.js';
import { prismaListArgs } from './prisma-args.js';

/** Same pinned image as prisma/tests/harness/postgres.ts. */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';

/** The Prisma `Membership` model's table (organisations migration), without its foreign keys and triggers. */
const MEMBERSHIPS_DDL = [
  `CREATE TABLE public.memberships (
     id uuid NOT NULL DEFAULT uuidv7(),
     created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     created_by uuid NOT NULL,
     updated_by uuid NOT NULL,
     version integer NOT NULL DEFAULT 1,
     org_id uuid NOT NULL,
     user_id uuid NOT NULL,
     status text NOT NULL CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
     invitation_id uuid,
     activated_at timestamptz(6),
     suspended_at timestamptz(6),
     removed_at timestamptz(6),
     removed_by uuid,
     CONSTRAINT pk_memberships PRIMARY KEY (id))`,
  'CREATE INDEX ix_memberships__org_status_created ON public.memberships (org_id, status, created_at, id)',
  'GRANT USAGE ON SCHEMA public TO platform_app',
  'GRANT SELECT ON TABLE public.memberships TO platform_app',
  // The real RLS helpers (platform.app_org_id() reads the transaction's organisation), applied from the released
  // migration as written, then a tenant policy of the real schema's shape over them.
  'CREATE SCHEMA platform',
  'GRANT USAGE ON SCHEMA platform TO platform_app',
  readFileSync(new URL('../../../../../prisma/migrations/20261112020000_platform_rls_helpers/migration.sql', import.meta.url), 'utf8'),
  'ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY',
  'CREATE POLICY p_memberships__tenant ON public.memberships FOR SELECT TO platform_app USING (org_id = platform.app_org_id())',
];

const ORG_A = randomUUID();
const ORG_B = randomUUID();
/** Organisations whose boundary rows the R1-M1 cases delete or move. */
const ORG_C = randomUUID();
const ORG_D = randomUUID();
const ACTOR = randomUUID();
/** Typed against the generated model's field names (R1-m6): a misspelt column fails `tsc`. */
const MEMBER_LIST = defineListSpec<Prisma.MembershipScalarFieldEnum>({
  sort: { fields: { created_at: { column: 'createdAt' } }, default: '-created_at' },
  filters: {
    status: { column: 'status', kind: 'enum', values: ['ACTIVE', 'SUSPENDED', 'REMOVED'], anyOf: true },
    created_at: { column: 'createdAt', kind: 'timestamp', range: true },
    version: { column: 'version', kind: 'integer' },
  },
});
const keyBytes = new Uint8Array(32).map((_, index) => (index * 37 + 11) % 256);
const codec = createCursorCodec({ current: { keyId: 'cursor-v1', localOnly: false, material: { reveal: () => keyBytes.slice() } } });

const configFor = (url: string): Config =>
  ({
    DATABASE_URL: { reveal: () => url },
    DB_POOL_MAX: 2,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
    DB_TX_LOCK_TIMEOUT_MS: 2_000,
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS,
    DB_TENANT_MAX_CONCURRENT_TX: 2,
    DB_TENANT_ADMISSION_WAIT_MS: 1_000,
  }) as unknown as Config;

const contextFor = (orgId: string): TenantContext => ({
  orgId,
  actorId: ACTOR,
  actorScope: 'TENANT',
  guestTokenHash: '',
  correlationId: 'it-keyset',
});

const principalFor = (orgId: string): Principal => ({
  credential: 'session',
  authenticated: true,
  actorId: ACTOR,
  orgId,
  actorScope: 'TENANT',
  guestTokenHash: '',
  permissions: new Set(),
});

let container: StartedPostgreSqlContainer;
let runtime: ActiveDatabaseRuntime<AppTransactionClient>;

/** Runs `sql` as the container's superuser (it owns the table and bypasses RLS). */
async function asSuperuser(sql: string, values: readonly unknown[] = []): Promise<pg.QueryResult> {
  const client = new pg.Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    return await client.query(sql, [...values]);
  } finally {
    await client.end();
  }
}

/** Creates `platform_app` with the bootstrap role settings and returns its connection URL (as health.int.test.ts). */
async function createAppRole(adminUrl: string): Promise<string> {
  const password = randomBytes(24).toString('hex');
  await asSuperuser(`CREATE ROLE platform_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${password}'`);
  for (const setting of EXPECTED_ROLE_SETTINGS) {
    const [name, value] = setting.split('=') as [string, string];
    await asSuperuser(`ALTER ROLE platform_app SET ${name} = ${name === 'search_path' ? value : `'${value}'`}`);
  }
  const url = new URL(adminUrl);
  url.username = 'platform_app';
  url.password = password;
  return url.toString();
}

/** Plants `count` ACTIVE memberships of `orgId`; `createdAt(n)` is the timestamptz text of row n. */
async function plant(
  orgId: string,
  count: number,
  createdAt: (n: number) => string,
  status: (n: number) => string = () => 'ACTIVE',
): Promise<void> {
  for (let n = 0; n < count; n += 1) {
    await asSuperuser(
      `INSERT INTO public.memberships (id, created_at, updated_at, created_by, updated_by, org_id, user_id, status)
       VALUES ($1, $2::timestamptz, $2::timestamptz, $3, $3, $4, $5, $6)`,
      [randomUUID(), createdAt(n), ACTOR, orgId, randomUUID(), status(n)],
    );
  }
}

/** The database's own order of the org's memberships (the ground truth). */
async function truth(orgId: string, direction: 'ASC' | 'DESC', status?: string): Promise<string[]> {
  const where = status === undefined ? '' : ' AND status = $2';
  const result = await asSuperuser(
    `SELECT id::text AS id FROM public.memberships WHERE org_id = $1${where} ORDER BY created_at ${direction}, id ${direction}`,
    status === undefined ? [orgId] : [orgId, status],
  );
  return result.rows.map((row: { id: string }) => row.id);
}

interface MemberRow {
  readonly id: string;
  readonly status: string;
}

/** One page of the org's memberships as the list convention reads it (platform_app, RLS on). */
async function readPage(orgId: string, raw: Record<string, unknown>): Promise<{ ids: string[]; next: string | null; hasMore: boolean }> {
  const validated = listQuerySchema(MEMBER_LIST).validate(raw, { convert: true });
  if (validated.error !== undefined) throw validated.error;
  const ctx: Pick<RouteRequestContext, 'route' | 'principal' | 'input'> = {
    route: { operationId: 'listMembers', tenancy: 'tenant' } as unknown as RouteDescriptor,
    principal: principalFor(orgId),
    input: { params: {}, query: validated.value as Record<string, unknown>, body: undefined, headers: {} },
  };
  const request = parseListQuery(MEMBER_LIST, ctx, codec);
  const args = prismaListArgs(request, { orgId });
  const rows = await runtime.tenantTx.withTenantTx(contextFor(orgId), async (tx) =>
    (tx as AppDb).membership.findMany({ ...(args as unknown as Prisma.MembershipFindManyArgs), select: { id: true, status: true } }),
  );
  const page = pageOf(request, rows as MemberRow[], { codec, idOf: (row) => row.id, toItem: (row) => row.id });
  return { ids: [...page.items], next: page.next_cursor, hasMore: page.has_more };
}

/** Every id, following next_cursor. */
async function walk(orgId: string, raw: Record<string, unknown>): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 200; pages += 1) {
    const page = await readPage(orgId, cursor === null ? raw : { ...raw, cursor });
    ids.push(...page.ids);
    if (!page.hasMore) return ids;
    cursor = page.next;
  }
  throw new Error('more than 200 pages');
}

beforeAll(async () => {
  delete process.env['PGOPTIONS'];
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const appUrl = await createAppRole(container.getConnectionUri());
  for (const statement of MEMBERSHIPS_DDL) await asSuperuser(statement);
  // Org A: 30 rows one microsecond apart inside one millisecond, 10 rows with the same instant, 20 a minute apart.
  await plant(
    ORG_A,
    30,
    (n) => `2026-11-21 12:00:00.123${String(n + 1).padStart(3, '0')}+00`,
    (n) => (n % 3 === 0 ? 'SUSPENDED' : 'ACTIVE'),
  );
  await plant(ORG_A, 10, () => '2026-11-21 12:00:00.123500+00');
  await plant(ORG_A, 20, (n) => `2026-11-21 12:${String(n + 1).padStart(2, '0')}:00+00`);
  await plant(ORG_B, 3, (n) => `2026-11-21 13:00:0${String(n)}+00`);
  await plant(ORG_C, 12, (n) => `2026-11-21 14:${String(n + 10)}:00.000001+00`);
  await plant(ORG_D, 12, (n) => `2026-11-21 15:${String(n + 10)}:00.000002+00`);
  runtime = databaseRuntimeFromConfig(configFor(appUrl), 'api', createRuntimeLog('api', { write: () => true }));
  await runtime.startup();
}, 300_000);

afterAll(async () => {
  for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
  await (container as StartedPostgreSqlContainer | undefined)?.stop();
}, 60_000);

describe('keyset pagination on PostgreSQL 18 as platform_app (prismaListArgs + pageOf)', () => {
  it('[AT-US-037-01] 60 rows: 25 per page with has_more and a cursor, then the rest without overlap or gaps (database order)', async () => {
    const first = await readPage(ORG_A, {});
    expect(first.ids).toHaveLength(25);
    expect(first.hasMore).toBe(true);
    expect(first.next).toEqual(expect.any(String));
    const all = await walk(ORG_A, {});
    expect(all).toEqual(await truth(ORG_A, 'DESC'));
    expect(new Set(all).size).toBe(60);
  });

  it('[AT-US-037-02] equal and microsecond-apart created_at values come back exactly once each, at every page size and direction', async () => {
    for (const limit of [1, 3, 7]) {
      expect(await walk(ORG_A, { sort: 'created_at', limit: String(limit) })).toEqual(await truth(ORG_A, 'ASC'));
      expect(await walk(ORG_A, { sort: '-created_at', limit: String(limit) })).toEqual(await truth(ORG_A, 'DESC'));
    }
  });

  it('[AT-US-037-05] filters combine with AND (status and a created_at range), newest first', async () => {
    const all = await walk(ORG_A, {
      'filter[status]': 'ACTIVE',
      'filter[created_at_from]': '2026-11-21T12:00:00.000Z',
      'filter[created_at_to]': '2026-11-21T12:00:01.000Z',
      limit: '4',
    });
    const active = await truth(ORG_A, 'DESC', 'ACTIVE');
    const inRange = await asSuperuser(
      `SELECT id::text AS id FROM public.memberships WHERE org_id = $1 AND status = 'ACTIVE'
         AND created_at >= '2026-11-21T12:00:00Z' AND created_at < '2026-11-21T12:00:01Z' ORDER BY created_at DESC, id DESC`,
      [ORG_A],
    );
    expect(all).toEqual(inRange.rows.map((row: { id: string }) => row.id));
    expect(all.length).toBeGreaterThan(4);
    expect(active.length).toBeGreaterThan(all.length);
  });

  it('a boundary row that stops matching the filter between pages leaves no gap (no skip: 1)', async () => {
    const first = await readPage(ORG_A, { 'filter[status]': 'ACTIVE', sort: 'created_at', limit: '5' });
    const boundary = first.ids.at(-1);
    if (boundary === undefined || first.next === null) throw new Error('no first page');
    const expectedRest = (await truth(ORG_A, 'ASC', 'ACTIVE')).slice(5);
    await asSuperuser(`UPDATE public.memberships SET status = 'SUSPENDED' WHERE id = $1`, [boundary]);
    try {
      const rest = await walk(ORG_A, { 'filter[status]': 'ACTIVE', sort: 'created_at', limit: '5', cursor: first.next });
      expect(rest).toEqual(expectedRest);
    } finally {
      await asSuperuser(`UPDATE public.memberships SET status = 'ACTIVE' WHERE id = $1`, [boundary]);
    }
  });

  it('[AT-US-037-10] org B cannot use org A cursors (refused by the binding); org B pages through its own rows', async () => {
    const first = await readPage(ORG_A, { limit: '2' });
    if (first.next === null) throw new Error('no cursor');
    await expect(readPage(ORG_B, { limit: '2', cursor: first.next })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(await walk(ORG_B, {})).toEqual(await truth(ORG_B, 'DESC'));
  });

  it('the tenant policy binds platform_app: without any condition it sees only the organisation of its transaction', async () => {
    const visible = await runtime.tenantTx.withTenantTx(contextFor(ORG_D), async (tx) => (tx as AppDb).membership.count());
    expect(visible).toBe(12);
  });

  it('R1-M1 / PR045-SEC-02: a boundary row deleted between pages is INVALID_CURSOR, never an empty last page', async () => {
    const first = await readPage(ORG_C, { sort: 'created_at', limit: '3' });
    const boundary = first.ids.at(-1);
    if (boundary === undefined || first.next === null) throw new Error('no first page');
    await asSuperuser('DELETE FROM public.memberships WHERE id = $1', [boundary]);
    await expect(readPage(ORG_C, { sort: 'created_at', limit: '3', cursor: first.next })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    // A fresh walk sees the remaining rows.
    expect(await walk(ORG_C, { sort: 'created_at', limit: '3' })).toEqual(await truth(ORG_C, 'ASC'));
  });

  it('PR045-SEC-02: a boundary row moved to another organisation (invisible under RLS) is INVALID_CURSOR; moved back, the walk continues', async () => {
    const first = await readPage(ORG_D, { sort: 'created_at', limit: '3' });
    const boundary = first.ids.at(-1);
    if (boundary === undefined || first.next === null) throw new Error('no first page');
    const expectedRest = (await truth(ORG_D, 'ASC')).slice(3);
    await asSuperuser('UPDATE public.memberships SET org_id = $2 WHERE id = $1', [boundary, ORG_B]);
    try {
      await expect(readPage(ORG_D, { sort: 'created_at', limit: '3', cursor: first.next })).rejects.toMatchObject({
        code: 'INVALID_CURSOR',
      });
    } finally {
      await asSuperuser('UPDATE public.memberships SET org_id = $2 WHERE id = $1', [boundary, ORG_D]);
    }
    expect(await walk(ORG_D, { sort: 'created_at', limit: '3', cursor: first.next })).toEqual(expectedRest);
  });

  it('PR045-SEC-01 controls: the int4 maximum and the years 0001 and 9999 are accepted by PostgreSQL (200, never 500)', async () => {
    expect((await readPage(ORG_A, { 'filter[version]': '2147483647' })).ids).toEqual([]);
    expect((await readPage(ORG_A, { 'filter[version]': '-2147483648' })).ids).toEqual([]);
    expect((await readPage(ORG_A, { 'filter[version]': '1', limit: '100' })).ids).toHaveLength(60);
    const bounded = await readPage(ORG_A, {
      'filter[created_at_from]': '0001-01-01T00:00:00Z',
      'filter[created_at_to]': '9999-12-31T23:59:59.999Z',
      limit: '100',
    });
    expect(bounded.ids).toEqual(await truth(ORG_A, 'DESC'));
  });
});
