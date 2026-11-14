/**
 * Suite `rls-cross-tenant` (US-077 AT-US-077-01..04; REQ-RLS-007; NFR-TENANT-001, NFR-SEC-011; data-model §4.6 C12 as a
 * generator; PR7-SEC-04, PR7-SEC-07 item 3; SEC-TC-06; T-QA-04; TASK-024). PostgreSQL 18 via Testcontainers, the
 * fully migrated template (bootstrap lane + every Prisma migration), probes as the runtime role `platform_app` with
 * the tenant context set by the production statement of withTenantTx.
 *
 * Two layers, one generator (`generator.ts`):
 *  - committed: every RLS-class table of `tools/db/table-classes/*.json` is probed on a clone of the migrated template.
 *    On `main` today the manifests list none (the first arrive with TASK-037/049/051), so this layer is empty until a
 *    migration adds one and its manifest line, and then it runs without any edit here (AT-US-077-03);
 *  - probe: one table per RLS class (TENANT with the standard-columns guard, GUEST_CAPABLE, USER_OWNED) and the three
 *    DR-A14 sets, planted on a second clone from the renderer and the function templates (`probe.ts`), so every probe
 *    kind is proven against real policies.
 * Mutation controls show the probes fail on a leaking policy, on a missing de-claim trigger and on an unlisted table.
 * API level (AT-US-077-02): every tenant-resource route of the module registry needs a registered case (none exist
 * yet); a fixture tenant route served by the composed createApp over the real runtime answers B's id with 404.
 *
 * Deterministic: every id and hash is derived from a label (`stableUuid`); each probe runs in its own rolled-back
 * transaction. Zero-skip: an unrunnable case fails.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { AppError } from '@platform/shared';
import Joi from 'joi';
import pg from 'pg';

import { createApp } from '../../../apps/api/src/app.js';
import { moduleRegistry } from '../../../apps/api/src/modules/index.generated.js';
import type { AppDb, AppTransactionClient } from '../../../apps/api/src/platform/db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../../../apps/api/src/platform/db/runtime.js';
import { markCredentialsRead, setPrincipal } from '../../../apps/api/src/platform/routing/route-state.js';
import { defaultPipelineSlots } from '../../../apps/api/src/platform/routing/pipeline.js';
import type { RouteSlot } from '../../../apps/api/src/platform/routing/slot.js';
import { defineRoute } from '../../../apps/api/src/platform/routing/define-route.js';
import { createRuntimeLog } from '../../../apps/api/src/platform/runtime/log.js';
import { APP_ROLE, PlatformPostgres } from '../../../prisma/tests/harness/postgres.js';
import { RLS_CLASSES, loadTableClasses, type TableClassEntry } from '../../../tools/db/table-classes.js';
import { loadApiMounts } from '../api-mounts.js';
import { readLiveTables, runCases, runProbe, seedTable, setTenantAContext, type TablePlan, TENANT_A, TENANT_B } from './database.js';
import { API_CASES } from './fixtures.js';
import {
  enumerationFindings,
  expectedObservation,
  generateCases,
  isolationKey,
  type IsolationCase,
  type LiveTable,
  routeCaseFindings,
} from './generator.js';
import { PROBE_ENTRIES, plantProbeSchema } from './probe.js';

const COMMITTED_ENTRIES = loadTableClasses();
const COMMITTED_CASES = generateCases(COMMITTED_ENTRIES);
const PROBE_CASES = generateCases(PROBE_ENTRIES);

interface Layer {
  readonly name: 'committed' | 'probe';
  readonly entries: readonly TableClassEntry[];
  database: string;
  live: LiveTable[];
  plans: Map<string, TablePlan>;
  app: pg.Client;
}

let db: PlatformPostgres;
const layers: Record<Layer['name'], Layer> = {
  committed: {
    name: 'committed',
    entries: COMMITTED_ENTRIES,
    database: '',
    live: [],
    plans: new Map(),
    app: undefined as unknown as pg.Client,
  },
  probe: {
    name: 'probe',
    entries: [...COMMITTED_ENTRIES, ...PROBE_ENTRIES],
    database: '',
    live: [],
    plans: new Map(),
    app: undefined as unknown as pg.Client,
  },
};

async function withSuperuser<T>(database: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await db.superuser(database);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Seeds every RLS table of `entries` that exists in `layer` and opens the layer's platform_app session. */
async function prepare(layer: Layer, rlsEntries: readonly TableClassEntry[]): Promise<void> {
  await withSuperuser(layer.database, async (superuser) => {
    layer.live = await readLiveTables(superuser);
    for (const entry of rlsEntries.filter((e) => RLS_CLASSES.has(e.class))) {
      const table = layer.live.find((live) => live.name === entry.name);
      if (table === undefined) continue; // reported by the enumeration test, never skipped silently
      layer.plans.set(entry.name, await seedTable(superuser, table, isolationKey(entry), entry.class === 'GUEST_CAPABLE'));
    }
  });
  layer.app = new pg.Client(db.appConnection(layer.database));
  await layer.app.connect();
}

beforeAll(async () => {
  db = await PlatformPostgres.start();
  const template = await db.template({ migrated: true });
  layers.committed.database = await db.clone(template);
  layers.probe.database = await db.clone(template);
  const migrator = new pg.Client(db.migratorConnection(layers.probe.database));
  await migrator.connect();
  try {
    await plantProbeSchema(migrator);
  } finally {
    await migrator.end();
  }
  await prepare(layers.committed, COMMITTED_ENTRIES);
  await prepare(layers.probe, PROBE_ENTRIES);
}, 300_000);

afterAll(async () => {
  for (const layer of Object.values(layers)) await (layer.app as pg.Client | undefined)?.end();
  await db?.stop();
}, 60_000);

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-04: the runtime role
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-077-04 the suite connects with the non-owner, non-BYPASSRLS runtime role', () => {
  it.each(['committed', 'probe'] as const)(
    'AT-US-077-04 %s layer: session and current user are platform_app, not superuser, no BYPASSRLS, owns no table under test',
    async (name) => {
      const layer = layers[name];
      const { rows } = await layer.app.query<{
        session_user: string;
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        owned: number;
      }>(
        `SELECT session_user::text AS session_user, current_user::text AS current_user, r.rolsuper, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_catalog.pg_class c WHERE c.relowner = r.oid) AS owned
         FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
      );
      expect(rows).toEqual([{ session_user: APP_ROLE, current_user: APP_ROLE, rolsuper: false, rolbypassrls: false, owned: 0 }]);
      const owners = await layer.app.query<{ relname: string; owner: string }>(
        `SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS owner FROM pg_catalog.pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY ($1)`,
        [[...layer.plans.keys()]],
      );
      expect(owners.rows.filter((row) => row.owner === APP_ROLE)).toEqual([]);
      expect(owners.rows).toHaveLength(layer.plans.size);
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-01: the generated table-level matrix
// ---------------------------------------------------------------------------------------------------------------------

const MATRIX: readonly (IsolationCase & { readonly layer: Layer['name'] })[] = [
  ...COMMITTED_CASES.map((c) => ({ ...c, layer: 'committed' as const })),
  ...PROBE_CASES.map((c) => ({ ...c, layer: 'probe' as const })),
];

describe('AT-US-077-01 table-level proof: generated per RLS table x probe kind (C12 generator)', () => {
  it.each(MATRIX.map((c) => [`[${c.layer}] ${c.title}`, c] as const))('%s', async (_title, isolationCase) => {
    const layer = layers[isolationCase.layer];
    const plan = layer.plans.get(isolationCase.table);
    expect(plan).toBeDefined(); // a listed table that does not exist fails here and in the enumeration test
    if (plan === undefined) return;
    const observed = await runProbe(layer.app, plan, isolationCase.kind);
    expect(observed).toEqual(expectedObservation(isolationCase.kind, plan.table.appPrivileges));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-03: enumeration and mutation controls
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-077-03 a new tenant table is picked up automatically; CI fails if it is not covered', () => {
  it('AT-US-077-03 committed: every public table is classified; every listed RLS table exists with ENABLE + FORCE, its key and (guest) de-claim trigger', () => {
    expect(enumerationFindings(COMMITTED_ENTRIES, layers.committed.live)).toEqual([]);
    expect([...layers.committed.plans.keys()].sort()).toEqual(
      COMMITTED_ENTRIES.filter((e) => COMMITTED_CASES.some((c) => c.table === e.name))
        .map((e) => e.name)
        .sort(),
    );
  });

  it('AT-US-077-03 probe: the planted tables are classified by their probe manifest and each has its generated cases', () => {
    expect(enumerationFindings(layers.probe.entries, layers.probe.live)).toEqual([]);
    expect([...layers.probe.plans.keys()].sort()).toEqual(PROBE_ENTRIES.map((e) => e.name).sort());
    for (const entry of PROBE_ENTRIES) expect(PROBE_CASES.filter((c) => c.table === entry.name).length).toBeGreaterThanOrEqual(11);
  });

  it('AT-US-077-03 a planted table with org_id that no manifest lists is named; a GUEST_CAPABLE table without its de-claim trigger is named', async () => {
    const findings = await withSuperuser(layers.probe.database, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('CREATE TABLE public.rls_probe_unlisted (id uuid PRIMARY KEY, org_id uuid NOT NULL)');
        await client.query('DROP TRIGGER tg_rls_probe_quotes__guest_capable_guard ON public.rls_probe_quotes');
        return enumerationFindings(layers.probe.entries, await readLiveTables(client));
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(findings).toEqual([
      'rls_probe_unlisted: table in no table-class manifest, so the generator cannot classify it',
      'rls_probe_quotes: GUEST_CAPABLE without tg_rls_probe_quotes__guest_capable_guard (PR7-SEC-04)',
    ]);
  });

  it('AT-US-077-03 mutation control: a leaking policy makes the generated probes of that table fail (the matrix is not vacuous)', async () => {
    const table = 'rls_probe_parcels';
    const cases = PROBE_CASES.filter((c) => c.table === table);
    const plan = layers.probe.plans.get(table);
    if (plan === undefined) throw new Error('probe plan missing');
    const client = await db.superuser(layers.probe.database);
    try {
      await client.query('BEGIN');
      await client.query(`CREATE POLICY p_rls_probe_parcels__leak ON public.${table} FOR SELECT TO platform_app USING (true)`);
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      const observed = await runCases(client, new Map([[table, plan]]), cases);
      const failing = cases.filter(
        (c) => JSON.stringify(observed.get(`${table} ${c.kind}`)) !== JSON.stringify(expectedObservation(c.kind, plan.table.appPrivileges)),
      );
      expect(failing.map((c) => c.kind)).toEqual(
        expect.arrayContaining([
          'select-foreign-id',
          'select-foreign-key',
          'no-context',
          'empty-context',
          'malformed-context',
          'forced-operator',
        ]),
      );
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });

  it('AT-US-077-03 the generator derives cases from the manifest alone: a new entry yields its full probe set without a suite edit', () => {
    const added: TableClassEntry = { module: 'future', name: 'future_orders', class: 'TENANT' };
    const before = generateCases(COMMITTED_ENTRIES).length;
    expect(generateCases([...COMMITTED_ENTRIES, added]).filter((c) => c.table === 'future_orders')).toHaveLength(11);
    expect(generateCases([...COMMITTED_ENTRIES, added])).toHaveLength(before + 11);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// DR-A14 semantics on the probe sets (data-model §4.3 as amended 2026-11-13; PR11-SEC-10)
// ---------------------------------------------------------------------------------------------------------------------

const DR_A14_PLANTED = PROBE_ENTRIES.some((entry) => entry.policySet === 'dr-a14-users');

describe('DR-A14 policy sets (PR11-SEC-10): positive status lists, own memberships, member organisations', () => {
  /** As superuser: plant memberships (rolled back), then as platform_app in A's context count the target rows. */
  async function visibleAs(
    memberships: readonly (readonly [org: string, user: string, status: string])[],
    sql: string,
    params: unknown[],
  ): Promise<number> {
    const client = await db.superuser(layers.probe.database);
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      for (const [index, [org, user, status]] of memberships.entries()) {
        await client.query('INSERT INTO public.memberships (id, org_id, user_id, status) VALUES ($1, $2, $3, $4)', [
          `00000000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
          org,
          user,
          status,
        ]);
      }
      await client.query('SET LOCAL session_replication_role = origin');
      await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
      await setTenantAContext(client);
      const { rows } = await client.query<{ n: number }>(sql, params);
      return rows[0]?.n ?? -1;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  const users = 'SELECT count(*)::int AS n FROM public.users WHERE id = $1';
  const orgs = 'SELECT count(*)::int AS n FROM public.organisations WHERE id = $1';
  const ownMemberships = 'SELECT count(*)::int AS n FROM public.memberships WHERE org_id = $1';

  it.each([
    ['INVITED', 0],
    ['ACTIVE', 1],
    ['SUSPENDED', 1],
    ['REMOVED', 0],
  ] as const)('users: B is visible to a session of org A iff B holds a %s membership in A (positive list)', async (status, expected) => {
    expect(DR_A14_PLANTED).toBe(true);
    expect(await visibleAs([], users, [TENANT_B.actor])).toBe(0);
    expect(await visibleAs([[TENANT_A.org, TENANT_B.actor, status]], users, [TENANT_B.actor])).toBe(expected);
  });

  it.each([
    ['ACTIVE', 1],
    ['SUSPENDED', 1],
    ['INVITED', 0],
    ['REMOVED', 0],
  ] as const)("organisations: org B is visible to A's actor iff the actor holds a %s membership in B", async (status, expected) => {
    expect(await visibleAs([], orgs, [TENANT_B.org])).toBe(0);
    expect(await visibleAs([[TENANT_B.org, TENANT_A.actor, status]], orgs, [TENANT_B.org])).toBe(expected);
  });

  it("memberships: the actor reads its own membership in another organisation (own_read) and no one else's there", async () => {
    expect(await visibleAs([[TENANT_B.org, TENANT_A.actor, 'ACTIVE']], ownMemberships, [TENANT_B.org])).toBe(1);
    expect(await visibleAs([[TENANT_B.org, TENANT_B.actor, 'ACTIVE']], ownMemberships, [TENANT_B.org])).toBe(0); // B's memberships in B stay invisible
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-02: API-level proof
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-077-02 API-level proof: tenant-resource routes answer 404 NOT_FOUND to another tenant', () => {
  it('AT-US-077-02 every tenant-resource route of the module registry has a registered cross-tenant case (none is skipped)', () => {
    expect(routeCaseFindings(loadApiMounts(moduleRegistry).descriptors, API_CASES)).toEqual([]);
    const planted = [
      { operationId: 'getShipment', method: 'get', path: '/shipments/:shipmentId', tenancy: 'tenant' },
      { operationId: 'listShipments', method: 'get', path: '/shipments', tenancy: 'tenant' },
      { operationId: 'getSession', method: 'get', path: '/me/sessions/{sessionId}', tenancy: 'user' },
      { operationId: 'getCountry', method: 'get', path: '/reference/countries/:code', tenancy: 'public' },
    ];
    expect(routeCaseFindings(planted, API_CASES)).toEqual([
      'GET /me/sessions/{sessionId} (getSession): tenant-resource route without a generated cross-tenant case',
      'GET /shipments/:shipmentId (getShipment): tenant-resource route without a generated cross-tenant case',
    ]);
    expect(routeCaseFindings(planted, new Set(['getShipment', 'getSession']))).toEqual([]);
  });

  describe('a fixture tenant route over the probe schema, through the composed createApp and the real runtime', () => {
    let runtime: ActiveDatabaseRuntime<AppTransactionClient>;
    let server: Server;
    let base: string;

    const PRINCIPAL_A = {
      credential: 'session',
      authenticated: true,
      actorId: TENANT_A.actor,
      orgId: TENANT_A.org,
      actorScope: 'TENANT',
      guestTokenHash: '',
      permissions: new Set<string>(),
    } as const;
    const asTenantA: RouteSlot = () => (_req, res, next) => {
      markCredentialsRead(res);
      setPrincipal(res, PRINCIPAL_A);
      next();
    };
    const getParcel = defineRoute({
      method: 'get',
      audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: 'RLS generator fixture.' },
      rateLimit: 'none',
      idempotency: 'not-applicable',
      operationId: 'probeGetParcel',
      path: '/fixtures/rls-probe/parcels/:id',
      tenancy: 'tenant',
      auth: 'session',
      permission: 'authenticated',
      permissionJustification: 'RLS generator fixture: any authenticated member of the active organisation.',
      transaction: 'tenant',
      schema: { params: Joi.object({ id: Joi.string().uuid() }) },
      handler: async ({ db: handle, input }) => {
        const id = String(input.params['id']);
        const rows = await (handle as AppDb).$queryRaw<{ id: string; ref: string }[]>`
          SELECT id::text AS id, ref FROM public.rls_probe_parcels WHERE id = ${id}::uuid`;
        const row = rows[0];
        if (row === undefined) throw new AppError('NOT_FOUND');
        return { status: 200, body: row };
      },
    });

    beforeAll(async () => {
      delete process.env['PGOPTIONS'];
      const config = {
        DATABASE_URL: { reveal: () => db.appUrl(layers.probe.database) },
        DB_POOL_MAX: 2,
        DB_IDLE_TIMEOUT_MS: 10_000,
        DB_CONNECTION_TIMEOUT_MS: 5_000,
        DB_STATEMENT_TIMEOUT_MS: 25_000,
        DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
        DB_TX_LOCK_TIMEOUT_MS: 2_000,
        DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
      } as unknown as Config;
      const log = createRuntimeLog('api', { write: () => true });
      runtime = databaseRuntimeFromConfig(config, 'api', log);
      await runtime.startup();
      const app = createApp({
        health: [],
        modules: [{ name: 'fixtures', routes: [getParcel] }],
        tenantTx: runtime.tenantTx,
        pipeline: { ...defaultPipelineSlots({ tenantTx: runtime.tenantTx }), authenticate: asTenantA },
        logger: log,
      });
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', () => resolve()));
      base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
    }, 120_000);

    afterAll(async () => {
      await new Promise<void>((resolve) => (server as Server | undefined)?.close(() => resolve()) ?? resolve());
      for (const resource of (runtime as ActiveDatabaseRuntime<AppTransactionClient> | undefined)?.resources ?? []) await resource.close();
    }, 60_000);

    it("AT-US-077-02 positive control: user A reads A's parcel (200)", async () => {
      const plan = layers.probe.plans.get('rls_probe_parcels');
      const response = await fetch(`${base}/fixtures/rls-probe/parcels/${plan?.rowA ?? ''}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: plan?.rowA, ref: 'rls-ref-A' });
    });

    it("AT-US-077-02 user A calling the tenant-resource route with B's id gets 404 NOT_FOUND with no B data", async () => {
      const plan = layers.probe.plans.get('rls_probe_parcels');
      const response = await fetch(`${base}/fixtures/rls-probe/parcels/${plan?.rowB ?? ''}`);
      const text = await response.text();
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toMatch(/^application\/problem\+json/u);
      expect((JSON.parse(text) as { code?: unknown }).code).toBe('NOT_FOUND');
      const problem = JSON.parse(text) as Record<string, unknown>;
      delete problem['instance']; // echoes the path A asked for
      expect(JSON.stringify(problem)).not.toContain(plan?.rowB ?? 'missing-plan');
      expect(text).not.toContain('rls-ref-B');
      expect(text).not.toContain(TENANT_B.org);
    });
  });
});
