/**
 * Executable cross-tenant API cases (AT-US-077-02; PR43-SEC-01, code review R1-M2; TASK-024). Every
 * `ApiCrossTenantCase` registered in `fixtures.ts` is run by `cross-tenant.int.test.ts` through this runner against an
 * app composed by `createApp` over the real database runtime, once per credential kind the route accepts:
 *  - `session`: user A asks for B's seeded row (404 `NOT_FOUND`, problem+json, no B value in the body), then for A's own
 *    row (the case's positive status);
 *  - `quote-token`: the guest of hash H2 asks for the guest row of hash H (404 as above), then the guest of hash H;
 *  - a dual-mode route (both kinds; code review R2-n2 (a), TASK-027): also the cross directions, user A asks for the
 *    guest row G and the guest of hash H asks for B's organisation row, each 404 as above.
 * A refusal must leak nothing of the other row in the body (except `instance`, which echoes the path asked for) or in any
 * response header (R2-n2 (b): `ETag`, `Location` and the like). A positive call answered with anything but its success
 * status is a problem, a 404 included whatever the case says (PR43-SEC-12). The runner returns problems instead of
 * asserting, so a mutation control can show that a leaking route fails it; api-cases.test.ts drives it over a fake
 * server without Docker (R2-n2 (c)).
 *
 * The principal is chosen per request by the test-only authenticate slot `probePrincipalSlot` from the header
 * `x-rls-probe-principal`; every other slot (MFA gate, authorise, rate limit, validate, idempotency, ETag, execute with
 * the tenant transaction) is the production one. User A holds every catalogued permission in organisation A, so an
 * authorisation refusal can never pass for isolation.
 */
import { PERMISSIONS } from '@platform/authz';

import type { Principal } from '../../../apps/api/src/platform/routing/define-route.js';
import { ANONYMOUS, markCredentialsRead, readonlySet, setPrincipal } from '../../../apps/api/src/platform/routing/route-state.js';
import type { RouteSlot } from '../../../apps/api/src/platform/routing/slot.js';
import { loadTableClasses } from '../../../tools/db/table-classes.js';
import { GUEST_HASH, OTHER_GUEST_HASH, type SeededRow, seededValues, type TablePlan, TENANT_A } from './database.js';
import { API_CASES } from './fixtures.js';
import { type ApiCrossTenantCase, isSuccessStatus, pathParameters, routeCaseFindings, type RouteShape } from './generator.js';

export const PRINCIPAL_HEADER = 'x-rls-probe-principal';

/**
 * The API enumeration of `routes` against the registered `API_CASES` and the committed table-class manifests: what the
 * rls-cross-tenant suite asserts for the module registry, also read by the RBAC matrix (AT-US-071-03, TASK-027).
 */
export const registryCaseFindings = (routes: readonly RouteShape[]): string[] => routeCaseFindings(routes, API_CASES, loadTableClasses());

export const PROBE_PRINCIPALS: Readonly<Record<string, Principal>> = {
  'tenant-a': Object.freeze({
    credential: 'session',
    authenticated: true,
    actorId: TENANT_A.actor,
    orgId: TENANT_A.org,
    actorScope: 'TENANT',
    guestTokenHash: '',
    permissions: readonlySet<string>(PERMISSIONS.map((permission) => permission.key)),
  }),
  'guest-h': Object.freeze({ ...ANONYMOUS, credential: 'quote-token', guestTokenHash: GUEST_HASH }),
  'guest-h2': Object.freeze({ ...ANONYMOUS, credential: 'quote-token', guestTokenHash: OTHER_GUEST_HASH }),
};

/** Test-only authenticate slot: the principal named by the request header, else anonymous. */
export const probePrincipalSlot: RouteSlot = () => (req, res, next) => {
  markCredentialsRead(res);
  const name = req.headers[PRINCIPAL_HEADER];
  setPrincipal(res, (typeof name === 'string' ? PROBE_PRINCIPALS[name] : undefined) ?? ANONYMOUS);
  next();
};

interface Call {
  readonly principal: keyof typeof PROBE_PRINCIPALS;
  readonly row: SeededRow;
  readonly negative: boolean;
}

/**
 * The calls of a case: per credential kind the route accepts, the cross-tenant (negative) call first, then the
 * positive; a route accepting both kinds then adds the two cross-direction negatives (R2-n2 (a)).
 */
export function callsFor(route: Pick<RouteShape, 'auth'>): Call[] {
  const calls: Call[] = [];
  const session = route.auth.includes('session');
  const guest = route.auth.includes('quote-token');
  if (session) {
    calls.push({ principal: 'tenant-a', row: 'B', negative: true }, { principal: 'tenant-a', row: 'A', negative: false });
  }
  if (guest) {
    calls.push({ principal: 'guest-h2', row: 'G', negative: true }, { principal: 'guest-h', row: 'G', negative: false });
  }
  if (session && guest) {
    calls.push({ principal: 'tenant-a', row: 'G', negative: true }, { principal: 'guest-h', row: 'B', negative: true });
  }
  return calls;
}

const text = (value: unknown): string => (Buffer.isBuffer(value) ? value.toString('hex') : String(value));

/** The route path with each parameter filled from the seeded row's column the case names. */
export function fillPath(path: string, params: Readonly<Record<string, string>>, values: Readonly<Record<string, unknown>>): string {
  let filled = path;
  for (const name of pathParameters(path)) {
    const column = params[name];
    if (column === undefined || !Object.hasOwn(values, column))
      throw new Error(`path parameter ${name}: no seeded column ${String(column)}`);
    filled = filled.replace(new RegExp(`:${name}(?=/|$)|\\{${name}\\}`), encodeURIComponent(text(values[column])));
  }
  return filled;
}

/**
 * The values of `row` that must never reach another tenant: every value of six characters or more, except the
 * synthetic constants every seeded row shares (equal in A and B).
 */
export function distinctiveValues(plan: TablePlan, row: SeededRow): string[] {
  const a = seededValues(plan, 'A');
  const b = seededValues(plan, 'B');
  const shared = new Set(
    Object.keys(a)
      .filter((column) => text(a[column]) === text(b[column]))
      .map((column) => text(a[column])),
  );
  return [...new Set(Object.values(seededValues(plan, row)).map(text))].filter((value) => value.length >= 6 && !shared.has(value));
}

/** Runs every call of one case against `base` (`http://host:port/api/v1`); returns the problems found (empty = pass). */
export async function runApiCase(base: string, route: RouteShape, apiCase: ApiCrossTenantCase, plan: TablePlan): Promise<string[]> {
  const problems: string[] = [];
  const calls = callsFor(route);
  if (calls.length === 0) problems.push(`${route.operationId}: no credential kind the runner can present`);
  for (const call of calls) {
    const label = `${route.operationId} [${call.principal} -> row ${call.row}]`;
    if (plan.seeded[call.row] === undefined) {
      problems.push(`${label}: table ${plan.table.name} has no seeded row ${call.row}`);
      continue;
    }
    const query = new URLSearchParams(apiCase.query ?? {}).toString();
    const url = `${base}${fillPath(route.path, apiCase.params, seededValues(plan, call.row))}${query === '' ? '' : `?${query}`}`;
    const response = await fetch(url, {
      method: route.method.toUpperCase(),
      headers: { [PRINCIPAL_HEADER]: call.principal, accept: 'application/json', 'content-type': 'application/json' },
      ...(apiCase.body === undefined ? {} : { body: JSON.stringify(apiCase.body) }),
    });
    const body = await response.text();
    if (!call.negative) {
      const expected = apiCase.positiveStatus ?? 200;
      if (!isSuccessStatus(expected)) problems.push(`${label}: positiveStatus ${String(expected)} is not a success status`);
      if (response.status !== expected || !isSuccessStatus(response.status))
        problems.push(`${label}: positive control expected ${String(expected)}, got ${String(response.status)}`);
      continue;
    }
    if (response.status !== 404) problems.push(`${label}: expected 404, got ${String(response.status)}`);
    if (!/^application\/problem\+json/u.test(response.headers.get('content-type') ?? ''))
      problems.push(`${label}: not a problem+json body`);
    let problem: Record<string, unknown> = {};
    try {
      problem = JSON.parse(body) as Record<string, unknown>;
    } catch {
      problems.push(`${label}: body is not JSON`);
    }
    if (problem['code'] !== 'NOT_FOUND') problems.push(`${label}: code ${String(problem['code'])}, expected NOT_FOUND`);
    delete problem['instance']; // echoes the path the caller asked for
    const visible = Object.keys(problem).length > 0 ? JSON.stringify(problem) : body;
    const distinctive = distinctiveValues(plan, call.row);
    const leaked = distinctive.filter((value) => visible.includes(value));
    if (leaked.length > 0) problems.push(`${label}: the body carries ${String(leaked.length)} value(s) of the other tenant's row`);
    for (const [name, value] of response.headers) {
      const inHeader = distinctive.filter((candidate) => value.includes(candidate));
      if (inHeader.length > 0)
        problems.push(`${label}: response header ${name} carries ${String(inHeader.length)} value(s) of the other tenant's row`);
    }
  }
  return problems;
}
