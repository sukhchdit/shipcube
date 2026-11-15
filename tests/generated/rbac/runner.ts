/**
 * Runs generated RBAC matrix cells over HTTP and returns problems instead of asserting (US-071; TASK-027), so the suite
 * can show that a wrong route or a wrong expectation fails (mutation controls). Per row: the `none` request first (the
 * reference of D-ARCH-109), then one request per cell with only that caller's credential.
 *
 * A cell passes when:
 *  - `allow`: 204 with `x-rbac-matrix: authorised` (the request passed authenticate, the MFA gate and authorise);
 *  - a refusal: the status and problem code of `REFUSALS`, `application/problem+json`, the terminal not reached;
 *  - `Cache-Control` is `private, no-store` exactly when the cell expects a private response (SEC-TC-29);
 *  - a foreign credential (outside the route's set): status, code and `Cache-Control` equal the `none` request.
 * The org-scope case (SEC-TC-01): 404 `NOT_FOUND` problem+json, and the foreign organisation's id appears in no
 * response header and nowhere in the body except `instance` (which echoes the requested path).
 */
import { type MatrixCaller, type MatrixRow, REFUSALS } from '@platform/authz';
import { PRIVATE_CACHE_CONTROL } from '../../../apps/api/src/platform/routing/route-state.js';
import { stableUuid } from '../rls/generator.js';
import { callerHeaders, MATRIX_ORGS, REACHED_HEADER, REACHED_VALUE } from './matrix-app.js';

/** A mounted route: method and full Express path (`/api/v1/shipments/:shipmentId`). */
export interface MatrixTarget {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

/** What one request observed. */
export interface Observed {
  readonly status: number;
  readonly code: string | undefined;
  readonly cacheControl: string;
  readonly reached: boolean;
  readonly problem: boolean;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
}

/** A stable synthetic value per parameter name (`orgId` defaults to the caller's own organisation). */
export const parameterValue = (name: string): string => (name === 'orgId' ? MATRIX_ORGS.CUSTOMER : stableUuid(`rbac-matrix:param:${name}`));

/** The path with every `:name` / `{name}` parameter filled (`overrides` first). */
export function fillPath(path: string, overrides: Readonly<Record<string, string>> = {}): string {
  return path.replaceAll(/:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\}/g, (_match, express: string | undefined, openapi: string | undefined) => {
    const name = String(express ?? openapi);
    return encodeURIComponent(overrides[name] ?? parameterValue(name));
  });
}

/** Sends one request presenting only `caller`'s credential. */
export async function observe(
  origin: string,
  target: MatrixTarget,
  caller: MatrixCaller,
  overrides: Readonly<Record<string, string>> = {},
): Promise<Observed> {
  const response = await fetch(`${origin}${fillPath(target.path, overrides)}`, {
    method: target.method.toUpperCase(),
    headers: { accept: 'application/json', ...callerHeaders(caller) },
  });
  const body = await response.text();
  const problem = /^application\/problem\+json/u.test(response.headers.get('content-type') ?? '');
  let code: string | undefined;
  if (problem) {
    const parsed = JSON.parse(body) as { readonly code?: unknown };
    code = typeof parsed.code === 'string' ? parsed.code : undefined;
  }
  return {
    status: response.status,
    code,
    cacheControl: response.headers.get('cache-control') ?? '',
    reached: response.headers.get(REACHED_HEADER) === REACHED_VALUE,
    problem,
    headers: new Map(response.headers.entries()),
    body,
  };
}

const shown = (observed: Observed): string =>
  `${String(observed.status)}${observed.code === undefined ? '' : ` ${observed.code}`} (Cache-Control "${observed.cacheControl}")`;

/** The problems of one observed cell; `none` is the row's no-credential observation. */
export function cellProblems(label: string, cell: MatrixRow['cells'][number], observed: Observed, none: Observed): string[] {
  const problems: string[] = [];
  if (cell.outcome === 'allow') {
    if (observed.status !== 204 || !observed.reached) problems.push(`${label}: expected allowed, got ${shown(observed)}`);
  } else {
    const refusal = REFUSALS[cell.outcome];
    if (observed.status !== refusal.status || observed.code !== refusal.code || !observed.problem || observed.reached) {
      problems.push(`${label}: expected ${String(refusal.status)} ${refusal.code}, got ${shown(observed)}`);
    }
  }
  if ((observed.cacheControl === PRIVATE_CACHE_CONTROL) !== cell.private) {
    problems.push(`${label}: Cache-Control "${observed.cacheControl}", expected ${cell.private ? '' : 'not '}"${PRIVATE_CACHE_CONTROL}"`);
  }
  const differs = observed.status !== none.status || observed.code !== none.code || observed.cacheControl !== none.cacheControl;
  if (cell.foreign && differs) {
    problems.push(
      `${label}: a credential outside the route's set changed the answer (no credential: ${shown(none)}; with it: ${shown(observed)})`,
    );
  }
  return problems;
}

/** Runs every cell of `row` against `target`; returns the problems (empty = the row passes). */
export async function runRow(
  origin: string,
  target: MatrixTarget,
  row: MatrixRow,
  callers: ReadonlyMap<string, MatrixCaller>,
): Promise<string[]> {
  const problems: string[] = [];
  const noneCaller: MatrixCaller = { id: 'none', kind: 'none' };
  const none = await observe(origin, target, noneCaller);
  for (const cell of row.cells) {
    const caller = callers.get(cell.caller);
    const label = `${target.operationId} x ${cell.caller}`;
    if (caller === undefined) {
      problems.push(`${label}: the cell names a caller the matrix does not have`);
      continue;
    }
    problems.push(...cellProblems(label, cell, cell.caller === noneCaller.id ? none : await observe(origin, target, caller), none));
  }
  return problems;
}

/** SEC-TC-01: `caller` (allowed in its active organisation) names the foreign organisation in the path. */
export async function runOrgCase(origin: string, target: MatrixTarget, caller: MatrixCaller): Promise<string[]> {
  const label = `[SEC-TC-01] ${target.operationId} x ${caller.id} -> foreign {orgId}`;
  const observed = await observe(origin, target, caller, { orgId: MATRIX_ORGS.FOREIGN });
  const problems: string[] = [];
  if (observed.status !== 404 || observed.code !== 'NOT_FOUND' || !observed.problem) {
    problems.push(`${label}: expected 404 NOT_FOUND, got ${shown(observed)}`);
  }
  let visible = observed.body;
  if (observed.problem) {
    const parsed = JSON.parse(observed.body) as Record<string, unknown>;
    delete parsed['instance']; // echoes the path the caller asked for
    visible = JSON.stringify(parsed);
  }
  if (visible.includes(MATRIX_ORGS.FOREIGN)) problems.push(`${label}: the body carries the foreign organisation's id`);
  for (const [name, value] of observed.headers) {
    if (value.includes(MATRIX_ORGS.FOREIGN)) problems.push(`${label}: response header ${name} carries the foreign organisation's id`);
  }
  return problems;
}
