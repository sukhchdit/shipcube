/**
 * Runs generated RBAC matrix cells over HTTP and returns problems instead of asserting (US-071; TASK-027, TASK-289), so
 * the suite can show that a wrong route or a wrong expectation fails (mutation controls; runner.test.ts pins every
 * check over a fake server). Per row: the `none` request first (the reference of D-ARCH-109), then one request per
 * cell with only that caller's credential.
 *
 * A cell passes when:
 *  - `allow`: 204 with `x-rbac-matrix: authorised` (the request passed authenticate, the MFA gate and authorise);
 *  - a refusal: the status and problem code of `REFUSALS`, `application/problem+json` with a JSON object body, the
 *    terminal not reached;
 *  - `Cache-Control` is `private, no-store` exactly when the cell expects a private response (SEC-TC-29);
 *  - a foreign credential (outside the route's set): the WHOLE response equals the `none` request but its volatile
 *    parts (PR48-SEC-01): the status, every header except `VOLATILE_HEADERS` and a body-derived ETag (name and value;
 *    an added `Set-Cookie` or `WWW-Authenticate` fails) and the body (a problem body without
 *    `VOLATILE_PROBLEM_MEMBERS`).
 * The org-scope case (SEC-TC-01): the caller first reaches the route with its OWN organisation on the authorisation app
 * (the route-reached control, PR48-SEC-05 item 1), then gets 404 `NOT_FOUND` problem+json for the foreign one, whose id
 * appears in no response header and nowhere in the body except `instance` (which echoes the requested path).
 *
 * Every request is one `fetchOnce` (a fresh loopback socket, no pool) under a per-request deadline of
 * `OBSERVE_DEADLINE_MS` (`AbortSignal.timeout`, PR #48 code review R1-m4). A transport failure (reset, deadline, refused)
 * is a `MatrixRequestError` naming the cell; `runRow` and `runOrgCase` turn it into a problem and stop that row, so one
 * hung or reset request fails the layer naming its cell instead of aborting all of it anonymously.
 */
import { createHash } from 'node:crypto';

import { type MatrixCaller, type MatrixRow, REFUSALS } from '@platform/authz/matrix';

import { fetchOnce } from '../../../apps/api/src/platform/routing/tests/loopback.js';
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
  /** The response is `application/problem+json`. */
  readonly problem: boolean;
  /** The problem document, when `problem` and the body is a JSON object (else undefined: a malformed problem). */
  readonly problemBody: Readonly<Record<string, unknown>> | undefined;
  /** Lower-case header name -> value; repeated headers (`Set-Cookie`) joined with a line feed. */
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
}

/**
 * Per-request deadline of `observe` (R1-m4). A loopback request of the matrix takes milliseconds alone and seconds
 * under parallel host load (rbac-matrix.api.test.ts bounds); 30 s only turns a hang into a named problem well inside
 * the contract layer's 900 s, it is no latency target. Pinned by a spy on `AbortSignal.timeout` (D-SEC-PR53-02).
 */
export const OBSERVE_DEADLINE_MS = 30_000;

/**
 * Response headers that differ between two identical requests (D-ARCH-109 comparison, PR48-SEC-01): the clock, the
 * per-request correlation id and the transport framing (`transfer-encoding` beside the record's `content-length`: a
 * body written in chunks instead of at once is framing, and the body itself is compared).
 */
export const VOLATILE_HEADERS: ReadonlySet<string> = new Set([
  'date',
  'x-correlation-id',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
]);
/**
 * Problem members that differ between two identical requests: the per-request correlation id only. `instance` is the
 * request path (apps/api platform/errors/problem.ts), the same for the `none` reference and every cell of a row, so it
 * is compared (PR #60 code review R1-n4; the PR48-SEC-01 record listed it as volatile, which was wider than needed).
 */
export const VOLATILE_PROBLEM_MEMBERS: readonly string[] = Object.freeze(['correlation_id']);

/**
 * Express's default weak ETag of `body` (the `etag` package: the byte length in hex and the first 27 base64 characters
 * of its SHA-1). A problem document's ETag is this hash of a body that carries the per-request `correlation_id`, so it
 * differs on every request; it adds nothing the body comparison does not see. Any other ETag is compared as a header.
 */
export function weakBodyEtag(body: string): string {
  const bytes = Buffer.from(body, 'utf8');
  return `W/"${bytes.byteLength.toString(16)}-${createHash('sha1').update(bytes).digest('base64').slice(0, 27)}"`;
}

/** A request that got no complete response: names the cell (operation x caller) and the transport cause. */
export class MatrixRequestError extends Error {
  override readonly name = 'MatrixRequestError';
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

/**
 * The cause of a transport failure as one line: error name, Node error code when there is one, message. Read by shape,
 * not `instanceof Error`: Node's socket errors and the `AbortSignal.timeout` DOMException come from another realm than
 * Jest's test context, where `instanceof Error` is false.
 */
function causeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { name, code, message } = error as { readonly name?: unknown; readonly code?: unknown; readonly message?: unknown };
  return `${typeof name === 'string' ? name : 'Error'}${typeof code === 'string' ? ` ${code}` : ''}: ${String(message)}`;
}

/** A JSON object body, or undefined (not JSON, or JSON that is not an object). */
function jsonObject(body: string): Readonly<Record<string, unknown>> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined; // reported by cellProblems as a malformed problem document
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

export interface ObserveOptions {
  /** Path parameter values that replace the defaults (`orgId: MATRIX_ORGS.FOREIGN`). */
  readonly overrides?: Readonly<Record<string, string>>;
  /** Test seam for the deadline (runner.test.ts); defaults to {@link OBSERVE_DEADLINE_MS}. */
  readonly deadlineMs?: number;
}

/** Sends one request presenting only `caller`'s credential; a transport failure rejects with a `MatrixRequestError`. */
export async function observe(origin: string, target: MatrixTarget, caller: MatrixCaller, options: ObserveOptions = {}): Promise<Observed> {
  const signal = AbortSignal.timeout(options.deadlineMs ?? OBSERVE_DEADLINE_MS);
  let response: Response;
  try {
    response = await fetchOnce(`${origin}${fillPath(target.path, options.overrides)}`, {
      method: target.method.toUpperCase(),
      headers: { accept: 'application/json', ...callerHeaders(caller) },
      signal,
    });
  } catch (error) {
    // A fired deadline is named by its reason (the TimeoutError), whatever error the transport surfaced for it; the
    // transport error stays the `cause`.
    const reason = causeOf(signal.aborted ? signal.reason : error);
    throw new MatrixRequestError(`${target.operationId} x ${caller.id}: request failed: ${reason}`, { cause: error });
  }
  const body = await response.text();
  const problem = /^application\/problem\+json/u.test(response.headers.get('content-type') ?? '');
  const problemBody = problem ? jsonObject(body) : undefined;
  const headers = new Map<string, string>();
  response.headers.forEach((value, name) => {
    const seen = headers.get(name);
    headers.set(name, seen === undefined ? value : `${seen}\n${value}`);
  });
  return {
    status: response.status,
    code: typeof problemBody?.['code'] === 'string' ? problemBody['code'] : undefined,
    cacheControl: response.headers.get('cache-control') ?? '',
    reached: response.headers.get(REACHED_HEADER) === REACHED_VALUE,
    problem,
    problemBody,
    headers,
    body,
  };
}

const shown = (observed: Observed): string =>
  `${String(observed.status)}${observed.code === undefined ? '' : ` ${observed.code}`} (Cache-Control "${observed.cacheControl}")`;

/** The body as compared: a problem document without its volatile members, any other body as sent. */
function comparableBody(observed: Observed): string {
  if (observed.problemBody === undefined) return observed.body;
  return JSON.stringify(
    Object.fromEntries(Object.entries(observed.problemBody).filter(([name]) => !VOLATILE_PROBLEM_MEMBERS.includes(name))),
  );
}

/** The headers as compared: without `VOLATILE_HEADERS`, and without an ETag that is Express's weak hash of the body. */
function comparableHeaders(observed: Observed): ReadonlyMap<string, string> {
  return new Map(
    [...observed.headers].filter(
      ([name, value]) => !VOLATILE_HEADERS.has(name) && !(name === 'etag' && value === weakBodyEtag(observed.body)),
    ),
  );
}

/**
 * How `observed` differs from `reference` outside the volatile parts, one entry per difference: the status, each header
 * (sorted by name; added, removed or changed) and the body. Empty = the same response.
 */
export function responseDifferences(observed: Observed, reference: Observed): string[] {
  const differences: string[] = [];
  if (observed.status !== reference.status) differences.push(`status ${String(reference.status)} -> ${String(observed.status)}`);
  const mine = comparableHeaders(observed);
  const theirs = comparableHeaders(reference);
  for (const name of [...new Set([...mine.keys(), ...theirs.keys()])].sort()) {
    if (mine.get(name) !== theirs.get(name)) differences.push(`header ${name}`);
  }
  if (comparableBody(observed) !== comparableBody(reference)) differences.push('body');
  return differences;
}

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
  if (observed.problem && observed.problemBody === undefined) problems.push(`${label}: the problem+json body is not a JSON object`);
  if ((observed.cacheControl === PRIVATE_CACHE_CONTROL) !== cell.private) {
    problems.push(`${label}: Cache-Control "${observed.cacheControl}", expected ${cell.private ? '' : 'not '}"${PRIVATE_CACHE_CONTROL}"`);
  }
  if (cell.foreign) {
    const differences = responseDifferences(observed, none);
    if (differences.length > 0) {
      problems.push(`${label}: a credential outside the route's set changed the response (${differences.join(', ')})`);
    }
  }
  return problems;
}

/**
 * Runs every cell of `row` against `target`; returns the problems (empty = the row passes). A transport failure is
 * one problem naming its cell, and the row stops there (its remaining cells would only wait out the same fault).
 */
export async function runRow(
  origin: string,
  target: MatrixTarget,
  row: MatrixRow,
  callers: ReadonlyMap<string, MatrixCaller>,
): Promise<string[]> {
  const problems: string[] = [];
  const noneCaller: MatrixCaller = { id: 'none', kind: 'none' };
  let checked = 0;
  try {
    const none = await observe(origin, target, noneCaller);
    for (const cell of row.cells) {
      const caller = callers.get(cell.caller);
      const label = `${target.operationId} x ${cell.caller}`;
      if (caller === undefined) problems.push(`${label}: the cell names a caller the matrix does not have`);
      else problems.push(...cellProblems(label, cell, cell.caller === noneCaller.id ? none : await observe(origin, target, caller), none));
      checked += 1;
    }
  } catch (error) {
    if (!(error instanceof MatrixRequestError)) throw error;
    problems.push(`${error.message} (the row stopped after ${String(checked)} of ${String(row.cells.length)} cells)`);
  }
  return problems;
}

/** The two apps of a SEC-TC-01 case: the authorisation app (its terminal answers) and the org-scope app. */
export interface OrgCaseOrigins {
  readonly matrix: string;
  readonly orgScope: string;
}

/**
 * SEC-TC-01: `caller` (allowed in its active organisation) reaches the route with its own organisation on the
 * authorisation app (route-reached control), then names the foreign organisation in the path on the org-scope app.
 */
export async function runOrgCase(origins: OrgCaseOrigins, target: MatrixTarget, caller: MatrixCaller): Promise<string[]> {
  const label = `[SEC-TC-01] ${target.operationId} x ${caller.id}`;
  const problems: string[] = [];
  try {
    const own = await observe(origins.matrix, target, caller);
    if (own.status !== 204 || !own.reached) {
      problems.push(`${label} -> own {orgId}: the route was not reached (expected 204 with ${REACHED_HEADER}, got ${shown(own)})`);
    }
    const observed = await observe(origins.orgScope, target, caller, { overrides: { orgId: MATRIX_ORGS.FOREIGN } });
    const foreign = `${label} -> foreign {orgId}`;
    if (observed.status !== 404 || observed.code !== 'NOT_FOUND' || !observed.problem) {
      problems.push(`${foreign}: expected 404 NOT_FOUND, got ${shown(observed)}`);
    }
    // `instance` echoes the path the caller asked for; everything else of the body must not carry the id.
    const visible =
      observed.problemBody === undefined
        ? observed.body
        : JSON.stringify(Object.fromEntries(Object.entries(observed.problemBody).filter(([name]) => name !== 'instance')));
    if (visible.includes(MATRIX_ORGS.FOREIGN)) problems.push(`${foreign}: the body carries the foreign organisation's id`);
    for (const [name, value] of observed.headers) {
      if (value.includes(MATRIX_ORGS.FOREIGN)) problems.push(`${foreign}: response header ${name} carries the foreign organisation's id`);
    }
  } catch (error) {
    if (!(error instanceof MatrixRequestError)) throw error;
    problems.push(`[SEC-TC-01] ${error.message}`);
  }
  return problems;
}
