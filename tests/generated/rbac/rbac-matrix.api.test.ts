/**
 * Suite `rbac-matrix` (US-071 AT-US-071-01..05; REQ-RBAC-011; NFR-SEC-011, NFR-TENANT-002; SEC-TC-01; T-QA-04;
 * D-ARCH-107, D-ARCH-109, D-ARCH-110; TASK-027). The generator (`packages/authz/src/generator`) derives one cell per
 * route x caller from the route metadata and the seeded roles; this suite runs every cell over HTTP through `createApp`
 * with the production authenticate fallback, MFA gate and authorise slots (`matrix-app.ts` documents the three seams).
 *
 * Two layers:
 *  - registry: every route the composed app mounts (health and the module registry), with its real descriptor;
 *  - contract: every operation of openapi.yaml as a contract-shaped descriptor, so each permission, credential set,
 *    dual-mode and signature route of the contract runs through the real slots before its module exists.
 * Plus the SEC-TC-01 org-scope cases, the committed matrix (AT-US-071-04/-05) and mutation controls showing that a
 * pipeline without its authorise or MFA step, or a stale expectation, fails. Deterministic: no clock, no randomness
 * (every id is derived from a label); nothing reaches a database.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  expectCell,
  FIXED_CALLERS,
  generateMatrix,
  type MatrixCaller,
  type MatrixRoute,
  type MatrixSource,
  matrixDrift,
  orgMismatchCases,
  parseRouteMatrix,
  pathParameterNames,
  PERMISSION_DEFINITIONS,
  ROLES,
  ROUTE_MATRIX_PATH,
  type RouteMatrix,
  signatureOnlyOf,
  verifiedId,
} from '@platform/authz';
import { AppError } from '@platform/shared';
import type { Express } from 'express';
import Joi from 'joi';

import { API_PREFIX } from '../../../apps/api/src/app.js';
import { moduleRegistry } from '../../../apps/api/src/modules/index.generated.js';
import { healthRoutes } from '../../../apps/api/src/platform/health/router.js';
import { defineRoute, type RouteContext, type RouteDescriptor } from '../../../apps/api/src/platform/routing/define-route.js';
import type { PipelineSlots } from '../../../apps/api/src/platform/routing/pipeline.js';
import { descriptorOf } from '../../../apps/api/src/platform/routing/route-registry.js';
import { REPO_ROOT, loadContract } from '../../../tools/openapi/contract.js';
import { listMountedRoutes } from '../../../tools/openapi/drift.js';
import { loadApiMounts } from '../api-mounts.js';
import { registryCaseFindings } from '../rls/api-cases.js';
import { contractDescriptor, type ContractRoute, contractRoutes } from './contract-routes.js';
import { composeMatrixApp, matrixPrincipals, matrixSlots, orgScopeSlots, type MatrixPrincipals } from './matrix-app.js';
import { type MatrixTarget, observe, runOrgCase, runRow } from './runner.js';

const SOURCE: MatrixSource = { roles: ROLES, catalogue: PERMISSION_DEFINITIONS };
const CALLERS: ReadonlyMap<string, MatrixCaller> = new Map(generateMatrix([], SOURCE).callers.map((caller) => [caller.id, caller]));
const PRINCIPALS: MatrixPrincipals = matrixPrincipals([...CALLERS.values()]);
const SIGNATURE_ONLY = signatureOnlyOf(PERMISSION_DEFINITIONS);
/** Contract rows run in parallel batches of this size (loopback only; each row's own requests stay sequential). */
const ROW_CONCURRENCY = 8;

/**
 * Per-test and per-hook bounds (the LOOPBACK_TEST_TIMEOUT_MS rationale of apps/api platform/routing/tests/loopback.ts).
 * A row is about 31 loopback requests, the contract layer about 4,300. Alone they take about 0.3 s and 15 s; under
 * parallel host load (flake loop 2026-11-14, runs 12-20) rows took over 5 s and the contract layer over 120 s, while
 * every result stayed correct. A hang still fails at the bound.
 */
const MATRIX_TEST_TIMEOUT_MS = 120_000;
const CONTRACT_LAYER_TIMEOUT_MS = 900_000;
jest.setTimeout(MATRIX_TEST_TIMEOUT_MS);

/** A readiness probe the matrix never calls (the terminal answers before any handler). */
const unusedProbe = {
  readiness: () => Promise.reject(new Error('the RBAC matrix never calls a handler')),
  startDraining: () => undefined,
  draining: false,
};

/** The matrix route of a mounted descriptor at its full path. */
const matrixRoute = (descriptor: RouteDescriptor, path: string): MatrixRoute => ({
  operationId: descriptor.operationId,
  method: descriptor.method,
  path,
  permission: descriptor.permission,
  tenancy: descriptor.tenancy,
  auth: descriptor.auth,
  permissionAuthenticated: descriptor.permissionAuthenticated,
  mfaGateExempt: descriptor.mfaGateExempt === true,
});

/** Every defineRoute route `app` mounts, as targets with their matrix routes (the walk of the drift check). */
function mountedTargets(app: Express): { readonly target: MatrixTarget; readonly route: MatrixRoute }[] {
  return listMountedRoutes([{ prefix: '', router: app.router }], { mountPaths: [API_PREFIX], excluded: [] }).flatMap((mounted) => {
    const descriptor = descriptorOf(mounted.handler);
    if (descriptor === undefined) return [];
    const target = { operationId: descriptor.operationId, method: mounted.method, path: mounted.path };
    return [{ target, route: matrixRoute(descriptor, mounted.path) }];
  });
}

interface Served {
  readonly origin: string;
  readonly server: Server;
}

/**
 * Loopback server for the matrix. The keep-alive timeout outlives the suite: with Node's 5 s default the server may
 * close an idle pooled socket just as fetch reuses it (ECONNRESET), which would be noise, not a matrix result.
 */
async function listen(app: Express): Promise<Served> {
  const server = app.listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise<void>((done) => server.once('listening', () => done()));
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, server };
}

const close = (served: Served | undefined): Promise<void> =>
  new Promise<void>((done) => {
    if (served === undefined) {
      done();
      return;
    }
    served.server.close(() => done());
    served.server.closeAllConnections();
  });

// ---------------------------------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------------------------------

const HEALTH = healthRoutes({ probe: unusedProbe });
const registryApp = (slots: PipelineSlots): Express => composeMatrixApp(HEALTH, moduleRegistry, slots);
const REGISTRY = mountedTargets(registryApp(matrixSlots(PRINCIPALS)));
const REGISTRY_MATRIX: RouteMatrix = generateMatrix(
  REGISTRY.map((entry) => entry.route),
  SOURCE,
);

/** Contract-shaped fixture descriptors of every openapi.yaml operation (`contract-routes.ts`). */
let CONTRACT: ContractRoute[] = [];
let CONTRACT_DESCRIPTORS: RouteDescriptor[] = [];
const contractApp = (slots: PipelineSlots): Express =>
  composeMatrixApp(
    CONTRACT_DESCRIPTORS.filter((_descriptor, index) => CONTRACT[index]?.mount === 'root'),
    [{ name: 'contract', routes: CONTRACT_DESCRIPTORS.filter((_descriptor, index) => CONTRACT[index]?.mount === 'api') }],
    slots,
  );

const served: { registry?: Served; contract?: Served } = {};
let contractTargets: { readonly target: MatrixTarget; readonly route: MatrixRoute }[] = [];
let contractMatrix: RouteMatrix = { callers: [], rows: [] };

beforeAll(async () => {
  CONTRACT = contractRoutes(await loadContract());
  CONTRACT_DESCRIPTORS = CONTRACT.map(contractDescriptor);
  const app = contractApp(matrixSlots(PRINCIPALS));
  contractTargets = mountedTargets(app);
  contractMatrix = generateMatrix(
    contractTargets.map((entry) => entry.route),
    SOURCE,
  );
  served.registry = await listen(registryApp(matrixSlots(PRINCIPALS)));
  served.contract = await listen(app);
}, MATRIX_TEST_TIMEOUT_MS);

afterAll(async () => {
  await close(served.registry);
  await close(served.contract);
});

const rowOf = (matrix: RouteMatrix, operationId: string): RouteMatrix['rows'][number] => {
  const row = matrix.rows.find((candidate) => candidate.route.operationId === operationId);
  if (row === undefined) throw new Error(`no matrix row for ${operationId}`);
  return row;
};

const targetOf = (targets: readonly { readonly target: MatrixTarget }[], operationId: string): MatrixTarget => {
  const found = targets.find((entry) => entry.target.operationId === operationId);
  if (found === undefined) throw new Error(`no mounted target for ${operationId}`);
  return found.target;
};

const caller = (id: string): MatrixCaller => {
  const found = CALLERS.get(id);
  if (found === undefined) throw new Error(`no caller ${id}`);
  return found;
};

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-071-01 / -02: every route x caller
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-071-01 registry layer: every mounted route x every seeded role (and every credential kind) gets its generated outcome', () => {
  it('the matrix covers exactly the routes of the composed app (health and the module registry), 17 roles, 8 verified staff and the fixed callers', () => {
    const api = loadApiMounts();
    const composed = listMountedRoutes(api.mounts, api.walk)
      .map((mounted) => descriptorOf(mounted.handler)?.operationId)
      .filter((id) => id !== undefined)
      .sort();
    expect(REGISTRY.map((entry) => entry.target.operationId).sort()).toEqual(composed);
    expect(composed.length).toBeGreaterThan(0);
    expect(REGISTRY_MATRIX.callers.filter((c) => c.kind === 'role' && c.factor !== 'verified')).toHaveLength(ROLES.length);
    expect(REGISTRY_MATRIX.callers.filter((c) => c.kind === 'role' && c.factor === 'verified')).toHaveLength(8);
    for (const row of REGISTRY_MATRIX.rows) expect(row.cells.length).toBeGreaterThanOrEqual(1 + ROLES.length + 8 + 5);
  });

  it.each(REGISTRY.map((entry) => [`${entry.target.method} ${entry.target.path} (${entry.target.operationId})`, entry.target] as const))(
    'AT-US-071-01 %s: every cell gets its generated outcome over HTTP',
    async (_title, target) => {
      expect(await runRow(String(served.registry?.origin), target, rowOf(REGISTRY_MATRIX, target.operationId), CALLERS)).toEqual([]);
    },
  );
});

describe('AT-US-071-01 contract layer: every openapi.yaml operation x every seeded role through the real authenticate, MFA-gate and authorise slots', () => {
  it('every contract operation is mounted once and has a row with a cell per applicable caller', () => {
    expect(contractTargets.map((entry) => entry.target.operationId).sort()).toEqual(
      CONTRACT.map((route) => route.matrix.operationId).sort(),
    );
    expect(contractTargets.length).toBeGreaterThanOrEqual(133);
    const signatureRoutes = contractMatrix.rows.filter((row) => row.route.auth.includes('signature'));
    expect(signatureRoutes.length).toBeGreaterThan(0);
    for (const row of contractMatrix.rows) {
      expect(row.cells).toHaveLength(CALLERS.size - (row.route.auth.includes('signature') ? 0 : 2));
    }
  });

  // The contract is read asynchronously (dereferenced), so the operations are one test; `runRow` names each failing
  // cell. Rows run ROW_CONCURRENCY at a time (each row's requests stay in order: the `none` reference first).
  it(
    'AT-US-071-01 every cell of every contract operation gets its generated outcome over HTTP',
    async () => {
      const problems: string[] = [];
      const operations = contractTargets.map((entry) => entry.target.operationId);
      for (let start = 0; start < operations.length; start += ROW_CONCURRENCY) {
        const batch = operations.slice(start, start + ROW_CONCURRENCY);
        const results = await Promise.all(
          batch.map((operationId) =>
            runRow(String(served.contract?.origin), targetOf(contractTargets, operationId), rowOf(contractMatrix, operationId), CALLERS),
          ),
        );
        problems.push(...results.flat());
      }
      expect(problems).toEqual([]);
    },
    CONTRACT_LAYER_TIMEOUT_MS,
  );

  it('AT-US-071-01 allow iff the role holds the permission, else 403 AUTHZ_DENIED (getShipment, shipment:read)', () => {
    const row = rowOf(contractMatrix, 'getShipment');
    for (const role of ROLES.filter((definition) => definition.scope !== 'OPERATOR')) {
      const held = (role.permissions as readonly string[]).includes('shipment:read');
      expect(row.cells.find((cell) => cell.caller === role.key)?.outcome).toBe(held ? 'allow' : 'deny-403');
    }
    for (const role of ROLES.filter((definition) => definition.scope === 'OPERATOR')) {
      const held = (role.permissions as readonly string[]).includes('shipment:read');
      expect(row.cells.find((cell) => cell.caller === role.key)?.outcome).toBe('deny-403-mfa');
      expect(row.cells.find((cell) => cell.caller === verifiedId(role.key))?.outcome).toBe(held ? 'allow' : 'deny-403');
    }
    expect(row.cells.some((cell) => cell.outcome === 'allow')).toBe(true);
    expect(row.cells.some((cell) => cell.outcome === 'deny-403')).toBe(true);
  });

  it('AT-US-071-02 every protected route (no anonymous in its set) answers a request without a credential with 401 AUTH_REQUIRED', async () => {
    const protectedRoutes = [...REGISTRY, ...contractTargets].filter((entry) => !entry.route.auth.includes('anonymous'));
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(100);
    const failures: string[] = [];
    for (const { target, route } of protectedRoutes) {
      const origin = String((REGISTRY.some((entry) => entry.target === target) ? served.registry : served.contract)?.origin);
      const observed = await observe(origin, target, caller(FIXED_CALLERS.none));
      expect(expectCell(route, caller(FIXED_CALLERS.none), SIGNATURE_ONLY).outcome).toBe('deny-401');
      if (observed.status !== 401 || observed.code !== 'AUTH_REQUIRED') failures.push(`${target.operationId}: ${String(observed.status)}`);
    }
    expect(failures).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// D-ARCH-107 / D-ARCH-109 / D-ARCH-110 named rows
// ---------------------------------------------------------------------------------------------------------------------

describe('D-ARCH-107/109/110 (ADR-0008 am. 4 and 5) credential kinds, foreign credentials and the signature-only gate', () => {
  const run = async (
    operationId: string,
    callerId: string,
  ): Promise<{ status: number; code: string | undefined; cacheControl: string }> => {
    const observed = await observe(String(served.contract?.origin), targetOf(contractTargets, operationId), caller(callerId));
    return { status: observed.status, code: observed.code, cacheControl: observed.cacheControl };
  };
  const firstOperation = (predicate: (route: MatrixRoute) => boolean): string => {
    const found = contractMatrix.rows.find((row) => predicate(row.route));
    if (found === undefined) throw new Error('no contract operation matches');
    return found.route.operationId;
  };
  const isSet = (route: MatrixRoute, ...kinds: string[]): boolean => route.auth.join(',') === kinds.join(',');

  it('D-ARCH-109 [anonymous] + a refresh cookie only, or + an expired bearer only: 200-class with the same Cache-Control as no credential (listCountries)', async () => {
    const none = await run('listCountries', FIXED_CALLERS.none);
    expect(none).toEqual({ status: 204, code: undefined, cacheControl: 'public, max-age=60' });
    expect(await run('listCountries', FIXED_CALLERS.refreshCookie)).toEqual(none);
    expect(await run('listCountries', FIXED_CALLERS.expiredBearer)).toEqual(none);
    expect(await run('listCountries', FIXED_CALLERS.guest)).toEqual(none);
    expect(await run('listCountries', 'CUSTOMER_OWNER')).toEqual(none);
  });

  it('D-ARCH-109 [session] + a refresh cookie only is 401 AUTH_REQUIRED (nothing consumed); [refresh-cookie] + an expired bearer only is 401', async () => {
    expect(await run('getShipment', FIXED_CALLERS.refreshCookie)).toEqual({
      status: 401,
      code: 'AUTH_REQUIRED',
      cacheControl: 'private, no-store',
    });
    const cookieRoute = firstOperation((route) => isSet(route, 'refresh-cookie'));
    expect(await run(cookieRoute, FIXED_CALLERS.expiredBearer)).toEqual({
      status: 401,
      code: 'AUTH_REQUIRED',
      cacheControl: 'private, no-store',
    });
    expect(await run(cookieRoute, 'CUSTOMER_OWNER')).toEqual({ status: 401, code: 'AUTH_REQUIRED', cacheControl: 'private, no-store' });
    expect((await run(cookieRoute, FIXED_CALLERS.refreshCookie)).status).toBe(204);
    expect((await run(cookieRoute, FIXED_CALLERS.unknownRefreshCookie)).status).toBe(401);
  });

  it('D-ARCH-107 [anonymous, session] (createQuote): the public branch is allowed; a session must hold x-permission-authenticated (else 403); an expired bearer is 401', async () => {
    const route = rowOf(contractMatrix, 'createQuote').route;
    expect(route.auth).toEqual(['anonymous', 'session']);
    const required = String(route.permissionAuthenticated);
    expect((await run('createQuote', FIXED_CALLERS.none)).status).toBe(204);
    for (const role of ROLES.filter((definition) => definition.scope !== 'OPERATOR')) {
      const held = (role.permissions as readonly string[]).includes(required);
      expect((await run('createQuote', role.key)).status).toBe(held ? 204 : 403);
    }
    expect(ROLES.some((role) => role.scope !== 'OPERATOR' && !(role.permissions as readonly string[]).includes(required))).toBe(true);
    expect(await run('createQuote', FIXED_CALLERS.expiredBearer)).toEqual({
      status: 401,
      code: 'AUTH_REQUIRED',
      cacheControl: 'private, no-store',
    });
  });

  it('D-ARCH-107 [session, quote-token] (getQuote): a valid guest token is allowed, an unknown one is 401, a session needs the permission; a credential outside the set is 401, never 403', async () => {
    expect(rowOf(contractMatrix, 'getQuote').route.auth).toEqual(['session', 'quote-token']);
    expect(await run('getQuote', FIXED_CALLERS.guest)).toEqual({ status: 204, code: undefined, cacheControl: 'private, no-store' });
    expect((await run('getQuote', FIXED_CALLERS.unknownGuestToken)).status).toBe(401);
    expect((await run('getQuote', FIXED_CALLERS.refreshCookie)).status).toBe(401);
    expect((await run('getQuote', FIXED_CALLERS.none)).status).toBe(401);
    expect((await run('getQuote', 'CUSTOMER_OWNER')).status).toBe(204);
  });

  it('D-ARCH-110 [signature]: a signature principal holding the permission 200-class, without it 403; a session on the signature route 401; a signature principal on a session route 401', async () => {
    const signed = firstOperation((route) => isSet(route, 'signature') && SIGNATURE_ONLY.has(route.permission));
    expect((await run(signed, FIXED_CALLERS.signatureHolds)).status).toBe(204);
    expect(await run(signed, FIXED_CALLERS.signatureLacks)).toEqual({
      status: 403,
      code: 'AUTHZ_DENIED',
      cacheControl: 'private, no-store',
    });
    expect((await run(signed, verifiedId('OPERATOR_SUPER_ADMIN'))).status).toBe(401);
    expect((await run(signed, FIXED_CALLERS.none)).status).toBe(401);
    // A signature header on a session route is never read: the request has no credential the route declares.
    const observed = await observe(
      String(served.contract?.origin),
      targetOf(contractTargets, 'getShipment'),
      caller(FIXED_CALLERS.signatureHolds),
    );
    expect(observed.status).toBe(401);
    const publicSigned = firstOperation((route) => isSet(route, 'signature') && route.permission === 'public');
    expect((await run(publicSigned, FIXED_CALLERS.signatureLacks)).status).toBe(204);
  });

  it('REQ-AUTH-018 staff before TOTP: a staff session is 403 on a route without x-mfa-gate-exempt and passes the gate on an exempt one', async () => {
    expect(await run('getShipment', 'OPERATOR_SUPER_ADMIN')).toEqual({
      status: 403,
      code: 'AUTHZ_DENIED',
      cacheControl: 'private, no-store',
    });
    const exempt = firstOperation((route) => route.mfaGateExempt === true && route.permission === 'authenticated');
    expect((await run(exempt, 'OPERATOR_SUPPORT')).status).toBe(204);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-071-03 and SEC-TC-01
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-071-03 cross-tenant case per tenant-resource route', () => {
  it('AT-US-071-03 every tenant/user/guest route of the registry that takes an id has an executable cross-tenant case (rls-cross-tenant runs each: 404 NOT_FOUND, no data)', () => {
    expect(registryCaseFindings(loadApiMounts().descriptors)).toEqual([]);
    const unregistered = registryCaseFindings([
      { operationId: 'getShipment', method: 'get', path: '/shipments/:shipmentId', tenancy: 'tenant', auth: ['session'] },
    ]);
    expect(unregistered).toEqual(['GET /shipments/:shipmentId (getShipment): tenant-resource route without a generated cross-tenant case']);
  });
});

const AUDIT_VIEW = Object.freeze({ action: 'VIEW', entity: 'organisation', sensitivity: 'SENSITIVE', reasonRequired: false });

/** SEC-TC-01 fixtures: a route that refuses a foreign org before any query, and three that fail the case. */
function orgRoute(operationId: string, handler: (ctx: RouteContext) => unknown): RouteDescriptor {
  return defineRoute({
    operationId,
    method: 'get',
    path: `/fixtures/rbac/${operationId.toLowerCase()}/organisations/:orgId`,
    permission: 'org:read',
    audit: AUDIT_VIEW,
    schema: { params: Joi.object({ orgId: Joi.string().required() }) },
    rateLimit: 'none',
    idempotency: 'not-applicable',
    tenancy: 'tenant',
    auth: 'session',
    handler: (ctx: RouteContext) => Promise.resolve(handler(ctx)),
  } as unknown as Parameters<typeof defineRoute>[0]);
}

const ORG_FIXTURES: readonly RouteDescriptor[] = [
  orgRoute('probeOrgScoped', ({ input, principal }) => {
    if (input.params['orgId'] !== principal.orgId) throw new AppError('NOT_FOUND');
    return { status: 200, body: { orgId: principal.orgId } };
  }),
  orgRoute('probeOrgLeaky', ({ input }) => ({ status: 200, body: { orgId: String(input.params['orgId']) } })),
  orgRoute('probeOrgQueries', ({ db }) => ({ status: 200, body: { touched: String((db as Record<string, unknown>)['organisation']) } })),
  orgRoute('probeOrgHeaderLeak', ({ input }) => ({
    status: 404,
    headers: { location: `/organisations/${String(input.params['orgId'])}` },
    body: { code: 'NOT_FOUND' },
  })),
];

describe('[SEC-TC-01] every route with {orgId}: active organisation != path organisation -> 404 NOT_FOUND, no data (T-32, AC-06)', () => {
  let orgServed: Served | undefined;
  let registryOrg: Served | undefined;
  const fixtureTargets = (): { readonly target: MatrixTarget; readonly route: MatrixRoute }[] =>
    mountedTargets(composeMatrixApp([], [{ name: 'fixtures', routes: ORG_FIXTURES }], orgScopeSlots(PRINCIPALS)));

  beforeAll(async () => {
    orgServed = await listen(composeMatrixApp([], [{ name: 'fixtures', routes: ORG_FIXTURES }], orgScopeSlots(PRINCIPALS)));
    registryOrg = await listen(registryApp(orgScopeSlots(PRINCIPALS)));
  });

  afterAll(async () => {
    await close(orgServed);
    await close(registryOrg);
  });

  it('[SEC-TC-01] registry: every tenant route with {orgId} has a generated case and each answers 404 NOT_FOUND before any query', async () => {
    const { cases, findings } = orgMismatchCases(REGISTRY_MATRIX);
    expect(findings).toEqual([]);
    const problems: string[] = [];
    for (const orgCase of cases) {
      problems.push(...(await runOrgCase(String(registryOrg?.origin), targetOf(REGISTRY, orgCase.route.operationId), orgCase.caller)));
    }
    expect(problems).toEqual([]);
  });

  it('[SEC-TC-01] the contract has 15 such operations, each with an allowed caller the case can use (the generator is ready for them)', () => {
    const { cases, findings } = orgMismatchCases(contractMatrix);
    expect(findings).toEqual([]);
    expect(cases.map((orgCase) => orgCase.route.operationId).sort()).toEqual(
      contractMatrix.rows
        .filter((row) => row.route.tenancy === 'tenant' && pathParameterNames(row.route.path).includes('orgId'))
        .map((row) => row.route.operationId)
        .sort(),
    );
    expect(cases).toHaveLength(15);
    expect(cases.every((orgCase) => orgCase.caller.scope === 'CUSTOMER')).toBe(true);
  });

  it('[SEC-TC-01] fixture proof: a refusing route passes; a leaking route, a route that queries first and a 404 that echoes the id in a header are named', async () => {
    const matrix = generateMatrix(
      fixtureTargets().map((entry) => entry.route),
      SOURCE,
    );
    const { cases, findings } = orgMismatchCases(matrix);
    expect(findings).toEqual([]);
    const results = new Map<string, string[]>();
    for (const orgCase of cases) {
      results.set(
        orgCase.route.operationId,
        await runOrgCase(String(orgServed?.origin), targetOf(fixtureTargets(), orgCase.route.operationId), orgCase.caller),
      );
    }
    expect(results.get('probeOrgScoped')).toEqual([]);
    expect(results.get('probeOrgLeaky')).toEqual([
      '[SEC-TC-01] probeOrgLeaky x CUSTOMER_OWNER -> foreign {orgId}: expected 404 NOT_FOUND, got 200 (Cache-Control "private, no-store")',
      "[SEC-TC-01] probeOrgLeaky x CUSTOMER_OWNER -> foreign {orgId}: the body carries the foreign organisation's id",
    ]);
    expect(results.get('probeOrgQueries')).toEqual([
      '[SEC-TC-01] probeOrgQueries x CUSTOMER_OWNER -> foreign {orgId}: expected 404 NOT_FOUND, got 500 INTERNAL_ERROR (Cache-Control "private, no-store")',
    ]);
    expect(results.get('probeOrgHeaderLeak')).toEqual([
      '[SEC-TC-01] probeOrgHeaderLeak x CUSTOMER_OWNER -> foreign {orgId}: expected 404 NOT_FOUND, got 404 (Cache-Control "private, no-store")',
      "[SEC-TC-01] probeOrgHeaderLeak x CUSTOMER_OWNER -> foreign {orgId}: response header location carries the foreign organisation's id",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// AT-US-071-04 / -05: the committed matrix
// ---------------------------------------------------------------------------------------------------------------------

describe('AT-US-071-04/-05 the committed matrix', () => {
  const committed = (): ReturnType<typeof parseRouteMatrix> =>
    parseRouteMatrix(readFileSync(resolve(REPO_ROOT, ROUTE_MATRIX_PATH), 'utf8'));

  it(`AT-US-071-04 every mounted route has its row in ${ROUTE_MATRIX_PATH} with the generated cells; the committed matrix equals the contract's`, () => {
    expect(matrixDrift(committed(), REGISTRY_MATRIX, { mode: 'subset' })).toEqual([]);
    expect(
      matrixDrift(
        committed(),
        generateMatrix(
          CONTRACT.map((route) => route.matrix),
          SOURCE,
        ),
      ),
    ).toEqual([]);
  });

  it('AT-US-071-04 a mounted route or a seeded role the committed matrix does not have fails, naming it', () => {
    const extraRoute: MatrixRoute = {
      ...rowOf(contractMatrix, 'getShipment').route,
      operationId: 'getParcelLabel',
      path: '/api/v1/parcels/:parcelId/label',
    };
    expect(matrixDrift(committed(), generateMatrix([extraRoute], SOURCE), { mode: 'subset' })).toEqual([
      'route GET /api/v1/parcels/:parcelId/label (getParcelLabel) has no row in the committed matrix',
    ]);
    const roles = [
      ...ROLES,
      { key: 'CUSTOMER_AUDITOR', scope: 'CUSTOMER' as const, nameKey: 'roles.customer.auditor', description: 'x', permissions: [] },
    ];
    const drift = matrixDrift(
      committed(),
      generateMatrix(
        REGISTRY.map((entry) => entry.route),
        { roles, catalogue: PERMISSION_DEFINITIONS },
      ),
      { mode: 'subset' },
    );
    expect(drift).toEqual(['role CUSTOMER_AUDITOR has no column in the committed matrix']);
  });

  it('AT-US-071-05 a changed seeded grant changes the generated expectation; the stale committed matrix fails CI and the stale expectation fails against the app', async () => {
    const viewer = ROLES.find((role) => role.key === 'CUSTOMER_VIEWER');
    if (viewer === undefined) throw new Error('CUSTOMER_VIEWER missing');
    expect((viewer.permissions as readonly string[]).includes('shipment:read')).toBe(true);
    const roles = ROLES.map((role) =>
      role === viewer ? { ...role, permissions: role.permissions.filter((p) => p !== 'shipment:read') } : role,
    );
    const changed = generateMatrix([rowOf(contractMatrix, 'getShipment').route], { roles, catalogue: PERMISSION_DEFINITIONS });
    expect(changed.rows[0]?.cells.find((cell) => cell.caller === 'CUSTOMER_VIEWER')?.outcome).toBe('deny-403');
    expect(matrixDrift(committed(), changed, { mode: 'subset' })).toEqual([
      'route GET /api/v1/shipments/:shipmentId (getShipment) x role CUSTOMER_VIEWER: committed Y, generated 403',
    ]);
    const stale = changed.rows[0];
    if (stale === undefined) throw new Error('no row');
    expect(await runRow(String(served.contract?.origin), targetOf(contractTargets, 'getShipment'), stale, CALLERS)).toEqual([
      'getShipment x CUSTOMER_VIEWER: expected 403 AUTHZ_DENIED, got 204 (Cache-Control "private, no-store")',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Mutation controls
// ---------------------------------------------------------------------------------------------------------------------

describe('mutation controls: the matrix is not vacuous', () => {
  it('without the authorise step every 401/403 cell of a permission route fails, and without the MFA gate every staff-before-TOTP cell fails', async () => {
    const pass: PipelineSlots['authorise'] = () => (_req, _res, next) => {
      next();
    };
    const target = targetOf(contractTargets, 'getShipment');
    const row = rowOf(contractMatrix, 'getShipment');
    const noAuthorise = await listen(contractApp({ ...matrixSlots(PRINCIPALS), authorise: pass }));
    const noMfa = await listen(contractApp({ ...matrixSlots(PRINCIPALS), mfaGate: pass }));
    try {
      const denied = row.cells.filter((cell) => cell.outcome === 'deny-403').map((cell) => cell.caller);
      const withoutAuthorise = await runRow(noAuthorise.origin, target, row, CALLERS);
      expect(denied.length).toBeGreaterThan(0);
      for (const id of denied)
        expect(withoutAuthorise).toContain(`getShipment x ${id}: expected 403 AUTHZ_DENIED, got 204 (Cache-Control "private, no-store")`);
      // Without the gate, a pending staff caller whose verified twin is allowed gets through: each is named.
      const allowedTwin = (id: string): boolean => row.cells.some((cell) => cell.caller === `${id}+mfa` && cell.outcome === 'allow');
      const pending = row.cells.filter((cell) => cell.outcome === 'deny-403-mfa').map((cell) => cell.caller);
      expect(pending).toHaveLength(8);
      const exposed = pending.filter(allowedTwin);
      expect(exposed.length).toBeGreaterThan(0);
      const withoutMfa = await runRow(noMfa.origin, target, row, CALLERS);
      expect(withoutMfa).toEqual(
        exposed.map((id) => `getShipment x ${id}: expected 403 AUTHZ_DENIED, got 204 (Cache-Control "private, no-store")`),
      );
    } finally {
      await close(noAuthorise);
      await close(noMfa);
    }
  });
});
