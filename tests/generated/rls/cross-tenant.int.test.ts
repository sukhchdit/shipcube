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
 *  - probe: one table per RLS class (TENANT with the standard-columns guard, GUEST_CAPABLE, USER_OWNED) and the
 *    DR-A14 sets not yet committed, planted on a second clone from the renderer and the function templates
 *    (`probe.ts`), so every probe kind is proven against real policies. The probe layer seeds the committed RLS tables
 *    too, so the DR-A14 semantics run on the real tables once they exist.
 * Mutation controls show the probes fail on a leaking read policy, on leaking write-only policies (PR43-SEC-02), on a
 * missing or replica-mode de-claim trigger and on an unlisted table or a relation outside `public`.
 * API level (AT-US-077-02): every tenant/user/guest route with a path parameter needs an executable case in
 * `API_CASES`; the suite runs each against the real module registry composed by createApp over the real runtime, and
 * runs the fixture cases (tenant, user and dual-mode guest routes over the probe schema) the same way, with a leaking
 * route as the mutation control (`api-cases.ts`).
 *
 * Deterministic: every id and hash is derived from a label (`stableUuid`); each probe runs in its own rolled-back
 * transaction; API cases restore the seeded rows. Zero-skip: an unrunnable case fails.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { Config } from '@platform/config';
import { AppError, OPERATOR_ORG_ID } from '@platform/shared';
import Joi from 'joi';
import pg from 'pg';

import { createApp, type ModuleRegistration } from '../../../apps/api/src/app.js';
import { moduleRegistry } from '../../../apps/api/src/modules/index.generated.js';
import type { AppDb, AppTransactionClient } from '../../../apps/api/src/platform/db/index.js';
import { type ActiveDatabaseRuntime, databaseRuntimeFromConfig } from '../../../apps/api/src/platform/db/runtime.js';
import { defaultPipelineSlots } from '../../../apps/api/src/platform/routing/pipeline.js';
import { closeLoopbackServer } from '../../../apps/api/src/platform/routing/tests/loopback.js';
import { defineRoute, type RouteContext, type RouteDescriptor } from '../../../apps/api/src/platform/routing/define-route.js';
import { createRuntimeLog } from '../../../apps/api/src/platform/runtime/log.js';
import { TEST_LANE_TX_IDLE_TIMEOUT_MS } from '../../../apps/api/src/platform/tx/tests/runtime-twin.js';
import { APP_ROLE, PlatformPostgres } from '../../../prisma/tests/harness/postgres.js';
import { RLS_CLASSES, loadTableClasses, type TableClassEntry } from '../../../tools/db/table-classes.js';
import { loadApiMounts } from '../api-mounts.js';
import { probePrincipalSlot, runApiCase } from './api-cases.js';
import {
  readLiveTables,
  restoreSeededRows,
  runCases,
  runProbe,
  seedTable,
  setContextValues,
  setTenantAContext,
  type TablePlan,
  TENANT_A,
  TENANT_B,
} from './database.js';
import { API_CASES, ROLE_SCOPE_GUARDS } from './fixtures.js';
import {
  type ApiCrossTenantCase,
  enumerationFindings,
  expectedObservation,
  generateCases,
  GUEST_PROBES,
  isolationKey,
  type IsolationCase,
  type LiveTable,
  routeCaseFindings,
  stableUuid,
  synthesiseRow,
  TABLE_PROBES,
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

const rlsNames = (entries: readonly TableClassEntry[]): string[] =>
  entries
    .filter((entry) => RLS_CLASSES.has(entry.class))
    .map((entry) => entry.name)
    .sort();

const publicTable = (layer: Layer, name: string): LiveTable | undefined =>
  layer.live.find((live) => live.schema === 'public' && live.name === name);

async function withSuperuser<T>(database: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = await db.superuser(database);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Seeds every RLS table of the layer's entries that exists and opens the layer's platform_app session. */
async function prepare(layer: Layer): Promise<void> {
  await withSuperuser(layer.database, async (superuser) => {
    layer.live = await readLiveTables(superuser);
    for (const entry of layer.entries.filter((e) => RLS_CLASSES.has(e.class))) {
      const table = publicTable(layer, entry.name);
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
  await prepare(layers.committed);
  await prepare(layers.probe);
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

const expectedFor = (isolationCase: IsolationCase, plan: TablePlan): ReturnType<typeof expectedObservation> =>
  expectedObservation(isolationCase.kind, plan.table.appPrivileges, isolationCase.traits);

describe('AT-US-077-01 table-level proof: generated per RLS table x probe kind (C12 generator)', () => {
  it.each(MATRIX.map((c) => [`[${c.layer}] ${c.title}`, c] as const))('%s', async (_title, isolationCase) => {
    const layer = layers[isolationCase.layer];
    const plan = layer.plans.get(isolationCase.table);
    expect(plan).toBeDefined(); // a listed table that does not exist fails here and in the enumeration test
    if (plan === undefined) return;
    const observed = await runProbe(layer.app, plan, isolationCase.kind);
    expect(observed).toEqual(expectedFor(isolationCase, plan));
  });

  it.each(['committed', 'probe'] as const)(
    'PR43-SEC-08 (b) %s layer: on a fresh platform_app session that never set an app.* key (NULL, not empty), every RLS table returns 0 rows',
    async (name) => {
      const layer = layers[name];
      for (const plan of layer.plans.values()) {
        const fresh = new pg.Client(db.appConnection(layer.database));
        await fresh.connect();
        try {
          expect([plan.table.name, await runProbe(fresh, plan, 'no-context')]).toEqual([
            plan.table.name,
            expectedObservation('no-context', plan.table.appPrivileges),
          ]);
        } finally {
          await fresh.end();
        }
      }
      if (name === 'probe') expect(layer.plans.size).toBeGreaterThanOrEqual(PROBE_ENTRIES.length);
    },
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-03: enumeration and mutation controls
// ---------------------------------------------------------------------------------------------------------------------

/** Runs `cases` of `table` as platform_app after `plant` (as superuser, rolled back); returns the kinds that fail. */
async function failingAfter(table: string, plant: (client: pg.Client) => Promise<void>): Promise<string[]> {
  const cases = PROBE_CASES.filter((c) => c.table === table);
  const plan = layers.probe.plans.get(table);
  if (plan === undefined) throw new Error(`probe plan ${table} missing`);
  const client = await db.superuser(layers.probe.database);
  try {
    await client.query('BEGIN');
    await plant(client);
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const observed = await runCases(client, new Map([[table, plan]]), cases);
    return cases
      .filter((c) => JSON.stringify(observed.get(`${table} ${c.kind}`)) !== JSON.stringify(expectedFor(c, plan)))
      .map((c) => c.kind);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

describe('AT-US-077-03 a new tenant table is picked up automatically; CI fails if it is not covered', () => {
  it('AT-US-077-03 committed: no relation outside public; every public table is classified; every listed RLS table exists with ENABLE + FORCE, its key and (guest) de-claim trigger', () => {
    expect(enumerationFindings(COMMITTED_ENTRIES, layers.committed.live)).toEqual([]);
    expect([...layers.committed.plans.keys()].sort()).toEqual(rlsNames(COMMITTED_ENTRIES));
  });

  it('D-TASK037-14 committed: every ROLE_SCOPE_GUARDS entry names a live, enabled trigger of an RLS table (the roleScopeGuard expectation is not stale)', () => {
    const stale = Object.entries(ROLE_SCOPE_GUARDS).filter(
      ([table, trigger]) => !(layers.committed.plans.get(table)?.table.triggers.includes(trigger) ?? false),
    );
    expect(stale).toEqual([]);
  });

  it('AT-US-077-03 probe: the planted tables are classified by their probe manifest and each has its generated cases', () => {
    expect(enumerationFindings(layers.probe.entries, layers.probe.live)).toEqual([]);
    expect([...layers.probe.plans.keys()].sort()).toEqual(rlsNames(layers.probe.entries));
    for (const entry of PROBE_ENTRIES) {
      expect(PROBE_CASES.filter((c) => c.table === entry.name).length).toBeGreaterThanOrEqual(TABLE_PROBES.length);
    }
  });

  it('AT-US-077-03 R1-m4 / PR43-SEC-05 (d) a planted unlisted table, a relation outside public and a replica-mode or dropped de-claim trigger are named', async () => {
    const findings = await withSuperuser(layers.probe.database, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('CREATE TABLE public.rls_probe_unlisted (id uuid PRIMARY KEY, org_id uuid NOT NULL)');
        await client.query('CREATE TABLE platform.rls_probe_hidden (id uuid PRIMARY KEY, org_id uuid NOT NULL)');
        await client.query('CREATE VIEW platform.rls_probe_hidden_v AS SELECT id FROM platform.rls_probe_hidden');
        await client.query('ALTER TABLE public.rls_probe_quotes ENABLE REPLICA TRIGGER tg_rls_probe_quotes__guest_capable_guard');
        return enumerationFindings(layers.probe.entries, await readLiveTables(client));
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(findings).toEqual([
      'platform.rls_probe_hidden: relation (relkind r) outside public, where no table-class manifest or RLS template reaches it',
      'platform.rls_probe_hidden_v: relation (relkind v) outside public, where no table-class manifest or RLS template reaches it',
      'rls_probe_unlisted: table in no table-class manifest, so the generator cannot classify it',
      'rls_probe_quotes: GUEST_CAPABLE without an enabled tg_rls_probe_quotes__guest_capable_guard (PR7-SEC-04, PR43-SEC-05 (d))',
    ]);
    const dropped = await withSuperuser(layers.probe.database, async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('DROP TRIGGER tg_rls_probe_quotes__guest_capable_guard ON public.rls_probe_quotes');
        return enumerationFindings(layers.probe.entries, await readLiveTables(client));
      } finally {
        await client.query('ROLLBACK');
      }
    });
    expect(dropped).toEqual([
      'rls_probe_quotes: GUEST_CAPABLE without an enabled tg_rls_probe_quotes__guest_capable_guard (PR7-SEC-04, PR43-SEC-05 (d))',
    ]);
  });

  it('AT-US-077-03 mutation control: a leaking read policy makes the read probes of that table fail (the matrix is not vacuous)', async () => {
    const failing = await failingAfter('rls_probe_parcels', async (client) => {
      await client.query('CREATE POLICY p_rls_probe_parcels__leak ON public.rls_probe_parcels FOR SELECT TO platform_app USING (true)');
    });
    expect(failing).toEqual(
      expect.arrayContaining([
        'select-foreign-id',
        'select-foreign-key',
        'no-context',
        'empty-context',
        'malformed-context',
        'forced-operator',
      ]),
    );
  });

  it('PR43-SEC-02 write mutation control: write-only leaking policies fail exactly the blind probes (the column-reading write probes and the re-parent are also held by the SELECT policies)', async () => {
    const tokens = await failingAfter('rls_probe_tokens', async (client) => {
      await client.query('CREATE POLICY p_rls_probe_tokens__leak_u ON public.rls_probe_tokens FOR UPDATE TO platform_app USING (true)');
      await client.query('CREATE POLICY p_rls_probe_tokens__leak_d ON public.rls_probe_tokens FOR DELETE TO platform_app USING (true)');
    });
    expect(tokens).toEqual(['update-blind', 'delete-blind']);
    const quotes = await failingAfter('rls_probe_quotes', async (client) => {
      await client.query('CREATE POLICY p_rls_probe_quotes__leak_u ON public.rls_probe_quotes FOR UPDATE TO platform_app USING (true)');
    });
    expect(quotes).toEqual(['update-blind', 'guest-update-other-hash']);
  });

  it('AT-US-077-03 the generator derives cases from the manifest alone: a new entry yields its full probe set without a suite edit', () => {
    const added: TableClassEntry = { module: 'future', name: 'future_orders', class: 'TENANT' };
    const guest: TableClassEntry = { module: 'future', name: 'future_quotes', class: 'GUEST_CAPABLE' };
    const before = generateCases(COMMITTED_ENTRIES).length;
    expect(generateCases([...COMMITTED_ENTRIES, added]).filter((c) => c.table === 'future_orders')).toHaveLength(TABLE_PROBES.length);
    expect(generateCases([...COMMITTED_ENTRIES, added, guest])).toHaveLength(before + 2 * TABLE_PROBES.length + GUEST_PROBES.length);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// DR-A14 semantics (data-model §4.3 as amended 2026-11-14, D-ARCH-123; PR11-SEC-10) and the operator scope
// ---------------------------------------------------------------------------------------------------------------------

type PlantedRow = readonly [table: string, values: Readonly<Record<string, unknown>>];

/**
 * As superuser: plant rows (rolled back; triggers and foreign keys off), synthesising whatever the live table needs
 * beyond `values` (so it works on the probe tables and on the real ones), then as platform_app in `context` run `fn`.
 */
async function asAppAfter<T>(
  rows: readonly PlantedRow[],
  context: (client: pg.Client) => Promise<void>,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = await db.superuser(layers.probe.database);
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    for (const [index, [name, values]] of rows.entries()) {
      const table = publicTable(layers.probe, name);
      if (table === undefined) throw new Error(`no table ${name} in the probe layer`);
      const row = synthesiseRow(table, values, `planted-${String(index)}`);
      const columns = row.columns.map((column) => `"${column}"`).join(', ');
      const params = row.columns.map((_, i) => `$${String(i + 1)}`).join(', ');
      await client.query(`INSERT INTO public."${name}" (${columns}) VALUES (${params})`, [...row.values]);
    }
    await client.query('SET LOCAL session_replication_role = origin');
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    await context(client);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

const membership = (org: string, user: string, status: string, index: number): PlantedRow => [
  'memberships',
  { id: stableUuid(`dr-a14:membership:${String(index)}:${org}:${user}:${status}`), org_id: org, user_id: user, status },
];

const count = async (client: pg.Client, sql: string, params: unknown[]): Promise<number> =>
  (await client.query<{ n: number }>(sql, params)).rows[0]?.n ?? -1;

describe('DR-A14 policy sets (PR11-SEC-10, D-ARCH-123): positive status lists, own memberships, member organisations', () => {
  const visibleAs = (rows: readonly PlantedRow[], sql: string, params: unknown[]): Promise<number> =>
    asAppAfter(rows, setTenantAContext, (client) => count(client, sql, params));

  const users = 'SELECT count(*)::int AS n FROM public.users WHERE id = $1';
  const orgs = 'SELECT count(*)::int AS n FROM public.organisations WHERE id = $1';
  const ownMemberships = 'SELECT count(*)::int AS n FROM public.memberships WHERE org_id = $1';

  it('the three DR-A14 tables are seeded in the probe layer (planted or committed)', () => {
    expect(['memberships', 'organisations', 'users'].filter((name) => layers.probe.plans.has(name))).toEqual([
      'memberships',
      'organisations',
      'users',
    ]);
  });

  it.each([
    ['INVITED', 0],
    ['ACTIVE', 1],
    ['SUSPENDED', 1],
    ['REMOVED', 0],
  ] as const)(
    'users: B is visible to a session of org A iff B holds a %s membership in A (positive list ACTIVE, SUSPENDED)',
    async (status, expected) => {
      expect(await visibleAs([], users, [TENANT_B.actor])).toBe(0);
      expect(await visibleAs([membership(TENANT_A.org, TENANT_B.actor, status, 1)], users, [TENANT_B.actor])).toBe(expected);
    },
  );

  it.each([
    ['ACTIVE', 1],
    ['SUSPENDED', 1],
    ['INVITED', 0],
    ['REMOVED', 0],
  ] as const)("organisations: org B is visible to A's actor iff the actor holds a %s membership in B", async (status, expected) => {
    expect(await visibleAs([], orgs, [TENANT_B.org])).toBe(0);
    expect(await visibleAs([membership(TENANT_B.org, TENANT_A.actor, status, 2)], orgs, [TENANT_B.org])).toBe(expected);
  });

  it("memberships: the actor reads its own membership in another organisation (own_read) and no one else's there", async () => {
    expect(await visibleAs([membership(TENANT_B.org, TENANT_A.actor, 'ACTIVE', 3)], ownMemberships, [TENANT_B.org])).toBe(1);
    // Another member of B (not TENANT_B.actor: the committed memberships table already holds the seeded live row
    // (B, TENANT_B.actor), and ux_memberships__org_user_live refuses a second one; PR #65 lane B, fix cycle 3).
    const otherMemberOfB = stableUuid('dr-a14:user:other-member-of-B');
    expect(await visibleAs([membership(TENANT_B.org, otherMemberOfB, 'ACTIVE', 4)], ownMemberships, [TENANT_B.org])).toBe(0); // B's memberships in B stay invisible
  });

  it("[SEC-TC-06] R1-n5 positive control: a genuine operator (ACTIVE member of the OPERATOR organisation, OPERATOR scope) reads B's row and still cannot write it; the same actor in TENANT scope sees nothing", async () => {
    const plan = layers.probe.plans.get('rls_probe_parcels');
    if (plan === undefined) throw new Error('probe plan missing');
    // The reserved operator organisation of the migration (D-ARCH-151): no fixture plants an OPERATOR organisation any
    // more (the occupied ux_organisations__single_operator would refuse it); the control adds only the membership.
    const operatorOrg = OPERATOR_ORG_ID;
    const operator = stableUuid('rls-generator:user-OPERATOR');
    const planted: PlantedRow[] = [membership(operatorOrg, operator, 'ACTIVE', 5)];
    const byId = 'SELECT count(*)::int AS n FROM public.rls_probe_parcels WHERE id = $1';
    const asOperator = (client: pg.Client): Promise<void> => setContextValues(client, operatorOrg, operator, 'OPERATOR');
    expect(await asAppAfter(planted, asOperator, (client) => count(client, byId, [plan.rowB]))).toBe(1);
    const updated = await asAppAfter(planted, asOperator, async (client) => {
      const result = await client.query('UPDATE public.rls_probe_parcels SET ref = ref WHERE id = $1', [plan.rowB]);
      return result.rowCount;
    });
    expect(updated).toBe(0);
    const asTenantScope = (client: pg.Client): Promise<void> => setContextValues(client, operatorOrg, operator, 'TENANT');
    expect(await asAppAfter(planted, asTenantScope, (client) => count(client, byId, [plan.rowB]))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-077-02: API-level proof (executable cases)
// ---------------------------------------------------------------------------------------------------------------------

const AUDIT_NONE = {
  action: 'NONE',
  entity: null,
  sensitivity: 'NONE',
  reasonRequired: false,
  justification: 'RLS generator fixture.',
} as const;

type ReadRow = (handle: AppDb, id: string) => Promise<{ id: string }[]>;

/** A fixture route reading one probe row by id through the request's tenant transaction (the production path). */
function readRoute(operationId: string, path: string, read: ReadRow, spec: Record<string, unknown>): RouteDescriptor {
  const param = path.slice(path.lastIndexOf(':') + 1);
  return defineRoute({
    method: 'get',
    audit: AUDIT_NONE,
    rateLimit: 'none',
    idempotency: 'not-applicable',
    operationId,
    path,
    permissionJustification: 'RLS generator fixture: any caller of the declared credential kinds.',
    transaction: 'tenant',
    schema: { params: Joi.object({ [param]: Joi.string().uuid() }) },
    handler: async ({ db: handle, input }: RouteContext) => {
      const rows = await read(handle as AppDb, String(input.params[param]));
      if (rows[0] === undefined) throw new AppError('NOT_FOUND');
      return { status: 200, body: rows[0] };
    },
    ...spec,
  } as unknown as Parameters<typeof defineRoute>[0]);
}

const FIXTURE_ROUTES: readonly RouteDescriptor[] = [
  readRoute(
    'probeGetParcel',
    '/fixtures/rls-probe/parcels/:parcelId',
    (handle, id) => handle.$queryRaw`SELECT id::text AS id FROM public.rls_probe_parcels WHERE id = ${id}::uuid`,
    { tenancy: 'tenant', auth: 'session', permission: 'authenticated' },
  ),
  readRoute(
    'probeGetToken',
    '/fixtures/rls-probe/tokens/:tokenId',
    (handle, id) => handle.$queryRaw`SELECT id::text AS id FROM public.rls_probe_tokens WHERE id = ${id}::uuid`,
    { tenancy: 'user', auth: 'session', permission: 'authenticated' },
  ),
  readRoute(
    'probeGetQuote',
    '/fixtures/rls-probe/quotes/:quoteId',
    (handle, id) => handle.$queryRaw`SELECT id::text AS id FROM public.rls_probe_quotes WHERE id = ${id}::uuid`,
    { tenancy: 'guest', auth: ['session', 'quote-token'], permission: 'public', permissionAuthenticated: 'quote:read' },
  ),
];

const FIXTURE_CASES: ReadonlyMap<string, ApiCrossTenantCase> = new Map([
  ['probeGetParcel', { table: 'rls_probe_parcels', params: { parcelId: 'id' } }],
  ['probeGetToken', { table: 'rls_probe_tokens', params: { tokenId: 'id' } }],
  ['probeGetQuote', { table: 'rls_probe_quotes', params: { quoteId: 'id' } }],
]);

/** Mutation control: a route that answers any id with 200 and echoes it (no isolation at all). */
const LEAKY_ROUTE: RouteDescriptor = defineRoute({
  method: 'get',
  audit: AUDIT_NONE,
  rateLimit: 'none',
  idempotency: 'not-applicable',
  operationId: 'probeLeakyParcel',
  path: '/fixtures/rls-probe/leaky-parcels/:parcelId',
  tenancy: 'tenant',
  auth: 'session',
  permission: 'authenticated',
  permissionJustification: 'RLS generator mutation control: a route that ignores isolation.',
  transaction: 'tenant',
  schema: { params: Joi.object({ parcelId: Joi.string().uuid() }) },
  handler: ({ input }) => Promise.resolve({ status: 200, body: { id: String(input.params['parcelId']) } }),
});

interface Served {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/** createApp over the real runtime on `database`, with the production slots except the test principal slot. */
async function serve(database: string, modules: readonly ModuleRegistration[]): Promise<Served> {
  const config = {
    DATABASE_URL: { reveal: () => db.appUrl(database) },
    DB_POOL_MAX: 2,
    DB_IDLE_TIMEOUT_MS: 10_000,
    DB_CONNECTION_TIMEOUT_MS: 5_000,
    DB_STATEMENT_TIMEOUT_MS: 25_000,
    DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
    DB_TX_LOCK_TIMEOUT_MS: 2_000,
    // The API-lane value (D-ARCH-106 (6)): a route holding its transaction open across a call fails here too.
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: TEST_LANE_TX_IDLE_TIMEOUT_MS,
  } as unknown as Config;
  const log = createRuntimeLog('api', { write: () => true });
  const runtime: ActiveDatabaseRuntime<AppTransactionClient> = databaseRuntimeFromConfig(config, 'api', log);
  await runtime.startup();
  const app = createApp({
    health: [],
    modules,
    tenantTx: runtime.tenantTx,
    pipeline: { ...defaultPipelineSlots({ tenantTx: runtime.tenantTx }), authenticate: probePrincipalSlot },
    logger: log,
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return {
    base: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`,
    close: async () => {
      await closeLoopbackServer(server);
      for (const resource of runtime.resources) await resource.close();
    },
  };
}

interface ExecutedCase {
  readonly layer: Layer['name'];
  readonly operationId: string;
  readonly apiCase: ApiCrossTenantCase;
}

/** Every registered case of the real registry, then the fixture cases: the list is never empty, and never hand-picked. */
const EXECUTED: readonly ExecutedCase[] = [
  ...[...API_CASES].map(([operationId, apiCase]) => ({ layer: 'committed' as const, operationId, apiCase })),
  ...[...FIXTURE_CASES].map(([operationId, apiCase]) => ({ layer: 'probe' as const, operationId, apiCase })),
];

describe('AT-US-077-02 API-level proof: tenant-, user- and guest-resource routes answer 404 NOT_FOUND to another tenant', () => {
  const served: Partial<Record<Layer['name'], Served>> = {};
  const routes: Record<Layer['name'], readonly RouteDescriptor[]> = {
    committed: loadApiMounts(moduleRegistry).descriptors,
    probe: [...FIXTURE_ROUTES, LEAKY_ROUTE],
  };

  beforeAll(async () => {
    delete process.env['PGOPTIONS'];
    served.committed = await serve(layers.committed.database, moduleRegistry);
    served.probe = await serve(layers.probe.database, [{ name: 'fixtures', routes: [...FIXTURE_ROUTES, LEAKY_ROUTE] }]);
  }, 120_000);

  afterAll(async () => {
    for (const server of Object.values(served)) await server.close();
  }, 60_000);

  it('AT-US-077-02 every tenant/user/guest route with a path parameter of the module registry has an executable case, and every case has its route', () => {
    expect(routeCaseFindings(routes.committed, API_CASES, COMMITTED_ENTRIES)).toEqual([]);
    expect(routeCaseFindings(FIXTURE_ROUTES, FIXTURE_CASES, layers.probe.entries)).toEqual([]);
    expect(EXECUTED.filter((c) => c.layer === 'committed')).toHaveLength(API_CASES.size);
  });

  it.each(EXECUTED.map((c) => [`[${c.layer}] ${c.operationId}`, c] as const))(
    "AT-US-077-02 %s: B's id (or another guest's quote) gives 404 NOT_FOUND without B data; A's own row gives the positive status",
    async (_title, executed) => {
      const route = routes[executed.layer].find((descriptor) => descriptor.operationId === executed.operationId);
      expect(route).toBeDefined();
      const plan = layers[executed.layer].plans.get(executed.apiCase.table);
      expect(plan).toBeDefined(); // a registered case whose table has no seeded plan fails
      const base = served[executed.layer]?.base;
      if (route === undefined || plan === undefined || base === undefined) return;
      try {
        expect(await runApiCase(base, route, executed.apiCase, plan)).toEqual([]);
      } finally {
        await withSuperuser(layers[executed.layer].database, (superuser) => restoreSeededRows(superuser, plan));
      }
    },
  );

  it('AT-US-077-02 mutation control: a route that ignores isolation fails its executed case (404 expected, data of B in the body)', async () => {
    const plan = layers.probe.plans.get('rls_probe_parcels');
    if (plan === undefined || served.probe === undefined) throw new Error('probe plan or server missing');
    const problems = await runApiCase(served.probe.base, LEAKY_ROUTE, { table: 'rls_probe_parcels', params: { parcelId: 'id' } }, plan);
    expect(problems).toEqual([
      'probeLeakyParcel [tenant-a -> row B]: expected 404, got 200',
      'probeLeakyParcel [tenant-a -> row B]: not a problem+json body',
      'probeLeakyParcel [tenant-a -> row B]: code undefined, expected NOT_FOUND',
      "probeLeakyParcel [tenant-a -> row B]: the body carries 1 value(s) of the other tenant's row",
    ]);
  });

  it('AT-US-077-02 the enumeration fails closed: a guest route, a stale case, a bare registration shape and an unpresentable credential are named', () => {
    const quote = { operationId: 'getQuote', method: 'get', path: '/quotes/:quoteId', tenancy: 'guest', auth: ['session', 'quote-token'] };
    const signed = { operationId: 'getSigned', method: 'get', path: '/signed/:id', tenancy: 'tenant', auth: ['signature'] };
    const cases = new Map<string, ApiCrossTenantCase>([
      ['getSigned', { table: 'rls_probe_parcels', params: { id: 'id' } }],
      ['gone', { table: 'rls_probe_parcels', params: {} }],
    ]);
    expect(routeCaseFindings([quote, signed], cases, layers.probe.entries)).toEqual([
      'GET /quotes/:quoteId (getQuote): tenant-resource route without a generated cross-tenant case',
      'GET /signed/:id (getSigned): accepts credential signature, which the cross-tenant case runner cannot present',
      'gone: registered cross-tenant case without a tenant-resource route',
    ]);
  });
});
