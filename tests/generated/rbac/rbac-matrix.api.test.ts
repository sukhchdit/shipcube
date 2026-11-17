/**
 * Suite `rbac-matrix` (US-071 AT-US-071-01..05; REQ-RBAC-011; NFR-SEC-011, NFR-TENANT-002; SEC-TC-01; T-QA-04;
 * D-ARCH-107, D-ARCH-109, D-ARCH-110; TASK-027, TASK-289). The generator (`@platform/authz/matrix`) derives one cell
 * per route x caller from the route metadata and the seeded roles; this suite runs every cell over HTTP through
 * `createApp` with the production authenticate stub, MFA gate and authorise slots behind the authentication seams of
 * `matrix-app.ts`.
 *
 * What it proves (D-ARCH-134; PR #48 code review R1-m2): the credential-kind selection (`presentedKinds`, D-ARCH-109),
 * the production authenticate stub, the MFA gate for pending staff and the permission gate of `authorise`, for every
 * cell. Not the authenticators (the seams stand in for them until TASK-052/055/091/171/261 and TASK-067 retire them)
 * and not the credential and actor gates of `authorise`, which the seams never reach (no principal of an undeclared
 * kind is built): apps/api platform/authz/authorise.test.ts proves those.
 *
 * Two layers:
 *  - registry: every route the composed app mounts (health and the module registry), with its real descriptor;
 *  - contract: every operation of openapi.yaml as a contract-shaped descriptor, so each permission, credential set,
 *    dual-mode and signature route of the contract runs through the real slots before its module exists.
 * Plus the SEC-TC-01 org-scope cases, the committed matrix (AT-US-071-04/-05) and mutation controls showing that a
 * pipeline without its authorise or MFA step, a stale expectation, or a foreign credential that changes the response
 * (S1-S4 of PR48-SEC-01) fails. Deterministic: no clock, no randomness (every id is derived from a label); nothing
 * reaches a database.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { PERMISSION_DEFINITIONS, ROLES, ROUTE_AUTHS } from '@platform/authz';
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
  presentedKind,
  ROUTE_MATRIX_PATH,
  type RouteMatrix,
  SIGNATURE_HEADER_NAMES,
  signatureHeaderId,
  signatureOnlyOf,
  verifiedId,
} from '@platform/authz/matrix';
import { AppError } from '@platform/shared';
import type { Express, NextFunction, Request, Response } from 'express';
import Joi from 'joi';

import { API_PREFIX } from '../../../apps/api/src/app.js';
import { moduleRegistry } from '../../../apps/api/src/modules/index.generated.js';
import { healthRoutes } from '../../../apps/api/src/platform/health/router.js';
import { defineRoute, type RouteContext, type RouteDescriptor } from '../../../apps/api/src/platform/routing/define-route.js';
import type { PipelineSlots } from '../../../apps/api/src/platform/routing/pipeline.js';
import { markCredentialsRead, markPrivateResponse } from '../../../apps/api/src/platform/routing/route-state.js';
import { descriptorOf } from '../../../apps/api/src/platform/routing/route-registry.js';
import { closeLoopbackServer } from '../../../apps/api/src/platform/routing/tests/loopback.js';
import { REPO_ROOT, loadContract } from '../../../tools/openapi/contract.js';
import { listMountedRoutes } from '../../../tools/openapi/drift.js';
import { loadApiMounts } from '../api-mounts.js';
import { registryCaseFindings } from '../rls/api-cases.js';
import { contractDescriptor, type ContractRoute, contractRoutes } from './contract-routes.js';
import {
  composeMatrixApp,
  matrixAuthenticate,
  matrixPrincipals,
  matrixSlots,
  orgScopeSlots,
  STUBBED_CREDENTIAL_KINDS,
  type MatrixPrincipals,
} from './matrix-app.js';
import { type MatrixTarget, observe, runOrgCase, runRow } from './runner.js';

const SOURCE: MatrixSource = { roles: ROLES, catalogue: PERMISSION_DEFINITIONS };
const CALLERS: ReadonlyMap<string, MatrixCaller> = new Map(generateMatrix([], SOURCE).callers.map((caller) => [caller.id, caller]));
const PRINCIPALS: MatrixPrincipals = matrixPrincipals([...CALLERS.values()]);
const SIGNATURE_ONLY = signatureOnlyOf(PERMISSION_DEFINITIONS);
/** Contract rows run in parallel batches of this size (loopback only; each row's own requests stay sequential). */
const ROW_CONCURRENCY = 8;

/**
 * Per-test and per-hook bounds (the LOOPBACK_TEST_TIMEOUT_MS rationale of apps/api platform/routing/tests/loopback.ts).
 * A row is about 34 loopback requests, the contract layer about 4,700. Alone they take about 0.3 s and 15 s; under
 * parallel host load (flake loop 2026-11-14, runs 12-20) rows took over 5 s and the contract layer over 120 s, while
 * every result stayed correct. These are hang detectors, never latency targets: one hung or reset request is named by
 * the runner's per-request deadline (OBSERVE_DEADLINE_MS, runner.ts) long before them.
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

/** Loopback server for the matrix; the runner sends every request with `fetchOnce` (a fresh socket, no pool). */
async function listen(app: Express): Promise<Served> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', () => done()));
  return { origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, server };
}

const close = (served: Served | undefined): Promise<void> =>
  served === undefined ? Promise.resolve() : closeLoopbackServer(served.server);

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

describe('AT-US-071-01 contract layer: every openapi.yaml operation x every caller through presentedKinds, the authenticate stub (seamed credentials), the MFA gate and the authorise permission gate', () => {
  it('every contract operation is mounted once and has a row with a cell per applicable caller', () => {
    expect(contractTargets.map((entry) => entry.target.operationId).sort()).toEqual(
      CONTRACT.map((route) => route.matrix.operationId).sort(),
    );
    expect(contractTargets.length).toBeGreaterThanOrEqual(133);
    const signatureRoutes = contractMatrix.rows.filter((row) => row.route.auth.includes('signature'));
    expect(signatureRoutes.length).toBeGreaterThan(0);
    // A signature route has the two synthetic signatures and no real signature header; every other route the reverse.
    for (const row of contractMatrix.rows) {
      expect(row.cells).toHaveLength(CALLERS.size - (row.route.auth.includes('signature') ? SIGNATURE_HEADER_NAMES.length : 2));
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
    // PR #48 R1-n2 and PR48-SEC-01: the admin refresh cookie and every real provider signature header are foreign too.
    expect(await run('listCountries', FIXED_CALLERS.unknownRefreshCookie)).toEqual(none);
    for (const name of SIGNATURE_HEADER_NAMES) expect(await run('listCountries', signatureHeaderId(name))).toEqual(none);
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

  // Truth in labelling (PR #48 R1-m2): the 401s of a session on the signature route and of a signature on a session
  // route come from presentedKinds and the authenticate stub (the seam builds no principal of an undeclared kind);
  // authorise's credential gate and its signature-credential check are proven by authorise.test.ts, not here.
  it('D-ARCH-110 [signature]: a signature principal holding the permission 200-class, without it 403 (authorise permission gate); a session on the signature route and a signature header on a session route are foreign: 401 from the stub', async () => {
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
    expect(await run('getShipment', signatureHeaderId('stripe-signature'))).toEqual(await run('getShipment', FIXED_CALLERS.none));
    const publicSigned = firstOperation((route) => isSet(route, 'signature') && route.permission === 'public');
    expect((await run(publicSigned, FIXED_CALLERS.signatureLacks)).status).toBe(204);
  });

  it('D-ARCH-134 the still-stubbed credential kinds: every kind but anonymous is resolved by the seam today, each presented by some caller (the list TASK-052 compares with the mounted authenticators)', () => {
    expect(STUBBED_CREDENTIAL_KINDS).toEqual(['session', 'refresh-cookie', 'quote-token', 'signature']);
    expect(ROUTE_AUTHS.filter((kind) => kind !== 'anonymous')).toEqual([...STUBBED_CREDENTIAL_KINDS]);
    const presented = new Set<string>([...CALLERS.values()].map(presentedKind));
    expect(STUBBED_CREDENTIAL_KINDS.filter((kind) => !presented.has(kind))).toEqual([]);
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
  let fixtureMatrix: Served | undefined;
  let registryOrg: Served | undefined;
  const fixtureApp = (slots: PipelineSlots): Express => composeMatrixApp([], [{ name: 'fixtures', routes: ORG_FIXTURES }], slots);
  const fixtureTargets = (): { readonly target: MatrixTarget; readonly route: MatrixRoute }[] =>
    mountedTargets(fixtureApp(orgScopeSlots(PRINCIPALS)));
  /** The authorisation app (route-reached control, PR48-SEC-05 item 1) and the org-scope app of one layer. */
  const origins = (matrix: Served | undefined, orgScope: Served | undefined): { matrix: string; orgScope: string } => ({
    matrix: String(matrix?.origin),
    orgScope: String(orgScope?.origin),
  });

  beforeAll(async () => {
    orgServed = await listen(fixtureApp(orgScopeSlots(PRINCIPALS)));
    fixtureMatrix = await listen(fixtureApp(matrixSlots(PRINCIPALS)));
    registryOrg = await listen(registryApp(orgScopeSlots(PRINCIPALS)));
  });

  afterAll(async () => {
    await close(orgServed);
    await close(fixtureMatrix);
    await close(registryOrg);
  });

  it('[SEC-TC-01] registry: every tenant route with {orgId} has a generated case; each is reached with the own organisation and answers 404 NOT_FOUND for a foreign one before any query', async () => {
    const { cases, findings } = orgMismatchCases(REGISTRY_MATRIX);
    expect(findings).toEqual([]);
    const problems: string[] = [];
    for (const orgCase of cases) {
      problems.push(
        ...(await runOrgCase(origins(served.registry, registryOrg), targetOf(REGISTRY, orgCase.route.operationId), orgCase.caller)),
      );
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

  it('[SEC-TC-01] fixture proof: a refusing route passes; a leaking route, a route that queries first, a 404 that echoes the id in a header and a target that is not reached are named', async () => {
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
        await runOrgCase(origins(fixtureMatrix, orgServed), targetOf(fixtureTargets(), orgCase.route.operationId), orgCase.caller),
      );
    }
    // Route-reached control (PR48-SEC-05 item 1): a target the app does not mount answers 404 NOT_FOUND for every
    // orgId (the fallback), which the foreign-org checks alone would accept.
    const scoped = targetOf(fixtureTargets(), 'probeOrgScoped');
    const unmounted: MatrixTarget = { ...scoped, operationId: 'probeOrgUnmounted', path: scoped.path.replace('/organisations/', '/orgs/') };
    expect(await runOrgCase(origins(fixtureMatrix, orgServed), unmounted, caller('CUSTOMER_OWNER'))).toEqual([
      '[SEC-TC-01] probeOrgUnmounted x CUSTOMER_OWNER -> own {orgId}: the route was not reached (expected 204 with x-rbac-matrix, got 404 NOT_FOUND (Cache-Control "private, no-store"))',
    ]);
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

  /**
   * PR48-SEC-01 S1-S4 (record probe B), each an authenticator defect around a foreign credential that left status, code
   * and Cache-Control alone and passed the PR #48 runner. The bend wraps the seamed authenticate slot of the real app.
   */
  type Bend = (route: RouteDescriptor, req: Request, res: Response, next: NextFunction) => boolean;
  const bentApp = async (bend: Bend): Promise<Served> =>
    listen(
      contractApp({
        ...matrixSlots(PRINCIPALS),
        authenticate: (route) => {
          const seamed = matrixAuthenticate(PRINCIPALS)(route);
          return (req, res, next) => {
            if (!bend(route, req, res, next)) seamed(req, res, next);
          };
        },
      }),
    );
  const foreign = (route: RouteDescriptor, kind: string, req: Request, header: string): boolean =>
    !route.auth.includes(kind as RouteDescriptor['auth'][number]) && req.headers[header] !== undefined;
  const changed = (operationId: string, ids: readonly string[], what: string): string[] =>
    ids.map((id) => `${operationId} x ${id}: a credential outside the route's set changed the response (${what})`);
  const runBent = async (bend: Bend, operationId: string): Promise<string[]> => {
    const app = await bentApp(bend);
    try {
      return await runRow(app.origin, targetOf(contractTargets, operationId), rowOf(contractMatrix, operationId), CALLERS);
    } finally {
      await close(app);
    }
  };
  const REFRESH_COOKIES = [FIXED_CALLERS.refreshCookie, FIXED_CALLERS.unknownRefreshCookie];

  it('PR48-SEC-01 S1 a foreign refresh cookie that makes the authenticator clear it (Set-Cookie) is named on every route outside [refresh-cookie]', async () => {
    const bend: Bend = (route, req, res) => {
      if (foreign(route, 'refresh-cookie', req, 'cookie'))
        res.setHeader('set-cookie', '__Host-rt_web=; Max-Age=0; Path=/; Secure; HttpOnly');
      return false;
    };
    expect(await runBent(bend, 'listCountries')).toEqual(changed('listCountries', REFRESH_COOKIES, 'header set-cookie'));
    expect(await runBent(bend, 'getShipment')).toEqual(changed('getShipment', REFRESH_COOKIES, 'header set-cookie'));
  });

  it('PR48-SEC-01 S2 a foreign bearer that adds WWW-Authenticate (status unchanged) is named for every bearer caller', async () => {
    const bend: Bend = (route, req, res) => {
      if (foreign(route, 'session', req, 'authorization')) res.setHeader('www-authenticate', 'Bearer error="invalid_token"');
      return false;
    };
    const bearers = rowOf(contractMatrix, 'listCountries')
      .cells.map((cell) => cell.caller)
      .filter((id) => presentedKind(caller(id)) === 'session');
    expect(bearers).toHaveLength(ROLES.length + 8 + 1);
    expect(await runBent(bend, 'listCountries')).toEqual(changed('listCountries', bearers, 'header www-authenticate'));
  });

  it('PR48-SEC-01 S3 a foreign refresh cookie that changes the 401 body on a [session] route (status, code and Cache-Control unchanged) is named', async () => {
    const bend: Bend = (route, req, res, next) => {
      if (!foreign(route, 'refresh-cookie', req, 'cookie') || route.auth.includes('anonymous')) return false;
      markCredentialsRead(res);
      markPrivateResponse(res);
      next(new AppError('AUTH_REQUIRED', { detail: 'The refresh cookie has expired.' }));
      return true;
    };
    expect(await runBent(bend, 'getShipment')).toEqual(changed('getShipment', REFRESH_COOKIES, 'body'));
  });

  it('PR48-SEC-01 S4 a real stripe-signature header read on every route (401) is named on an [anonymous] route', async () => {
    const bend: Bend = (route, req, res, next) => {
      if (!foreign(route, 'signature', req, 'stripe-signature')) return false;
      markCredentialsRead(res);
      markPrivateResponse(res);
      next(new AppError('AUTH_REQUIRED'));
      return true;
    };
    const stripe = signatureHeaderId('stripe-signature');
    expect(await runBent(bend, 'listCountries')).toEqual([
      `listCountries x ${stripe}: expected allowed, got 401 AUTH_REQUIRED (Cache-Control "private, no-store")`,
      `listCountries x ${stripe}: Cache-Control "private, no-store", expected not "private, no-store"`,
      ...changed('listCountries', [stripe], 'status 204 -> 401, header cache-control, header content-type, header x-rbac-matrix, body'),
    ]);
  });
});
