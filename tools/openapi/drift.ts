/**
 * Route/document drift check (US-034 AT-US-034-01/02, US-035 AT-US-035-05; REQ-API-002/015; api/README.md §15, the
 * TASK-017 part): walks the mounted Express 5 routers, compares them with the contract and the implemented-operations
 * ledger, and checks every documented operation for examples, error codes, a permission, its operationId, its
 * traceability extensions (rule 7) and sunset.
 * Pure apart from `readLedger`. TASK-020 adds the defineRoute metadata comparison (x-audit, x-idempotency, Joi parity).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type ContractOperation, listOperations, type OpenApiDocument, type OperationObject, REPO_ROOT } from './contract.js';

/** Operations that must be mounted now; every API task appends its operationIds (tools/openapi/README.md). */
export const LEDGER_PATH = resolve(REPO_ROOT, 'tools', 'openapi', 'implemented-operations.json');

export type DriftRule =
  | 'undocumented-route'
  | 'unrecognised-route'
  | 'not-mounted'
  | 'not-in-ledger'
  | 'unknown-ledger-entry'
  | 'missing-example'
  | 'missing-error-codes'
  | 'missing-permission'
  | 'operation-id'
  | 'deprecated-without-sunset'
  | 'sunset-passed'
  | 'missing-traceability';

export interface DriftFinding {
  readonly rule: DriftRule;
  /** Upper-case method, or `*` when the walker could not tell. */
  readonly method: string;
  /** The served path (`/api/v1/shipments/{shipmentId}`, or the Express path for a route the document lacks). */
  readonly path: string;
  readonly operationId?: string;
  readonly message: string;
}

export interface Mount {
  /** Mount prefix of the router: `''` for the root (health), `/api/v1` for the module routers. */
  readonly prefix: string;
  readonly router: unknown;
}

/**
 * How path-mounted routers are resolved. Express 5 layers keep no mount path, so a router mounted under a path is
 * resolved only when its layer matches one of `mountPaths` literally (probed with the layer's own matcher); any other
 * path-mounted layer is reported as unrecognised.
 */
export interface WalkOptions {
  /** Full literal mount paths from the walk root, e.g. `/api/v1` and `/api/docs`. */
  readonly mountPaths?: readonly string[];
  /** Full mount paths whose routers are deliberately not compared with the contract (api/README.md §15: `/api/docs`). */
  readonly excluded?: readonly string[];
}

export interface MountedRoute {
  /** Upper-case method (`*` for an unrecognised layer). */
  readonly method: string;
  /** Full Express path, e.g. `/api/v1/shipments/:shipmentId`. */
  readonly path: string;
  /** Comparison key: method plus the path with every parameter as `{}` (`GET /api/v1/shipments/{}`). */
  readonly key: string;
  /** Set when the layer could not be resolved to a method and path; reported as `unrecognised-route`. */
  readonly unrecognised?: string;
}

export interface DriftInput {
  readonly doc: OpenApiDocument;
  readonly mounted: readonly MountedRoute[];
  /** operationIds from the ledger. */
  readonly implemented: readonly string[];
  /** Reference time for `sunset-passed`; defaults to the real clock (the contract test on `main` runs on it). */
  readonly now?: Date;
}

const MAX_PATH_LENGTH = 2048;
const MAX_ROUTER_DEPTH = 32;
const OPERATION_ID = /^[a-z][a-zA-Z0-9]{0,127}$/;
/** Express 5 path syntax the walker cannot compare: optional groups, wildcards, regexp fragments. */
const UNSUPPORTED_EXPRESS_SYNTAX = /[{}*()?+[\]\\]/;
const ACCESS_KEYWORDS = new Set(['public', 'authenticated']);
/** REQUIREMENTS.md IDs (`REQ-AUTH-001`); milestones of the roadmap (M0-M5); MoSCoW of a contract operation. */
const REQUIREMENT_ID = /^REQ-[A-Z0-9]{2,12}-\d{3}$/;
const MILESTONE = /^M[0-5]$/;
const MOSCOW = new Set(['Must', 'Should', 'Could']);

/** `:param` and `{param}` both become `{}` (api/README.md §15 normalisation). */
export function normalisePath(path: string): string {
  if (path.length > MAX_PATH_LENGTH) throw new Error(`path longer than ${MAX_PATH_LENGTH} characters`);
  return path.replaceAll(/\{[^{}/]+\}/g, '{}').replaceAll(/:[A-Za-z0-9_$]+/g, '{}');
}

export const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${normalisePath(path)}`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

const joinPath = (prefix: string, path: string): string => {
  const joined = `${prefix.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  return joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
};

function unrecognised(path: string, reason: string): MountedRoute {
  return { method: '*', path, key: `* ${path}`, unrecognised: reason };
}

function routeLayer(prefix: string, route: Readonly<Record<string, unknown>>): MountedRoute[] {
  const { path, methods } = route;
  if (typeof path !== 'string') return [unrecognised(prefix || '/', 'route path is not a string (array or RegExp)')];
  const full = joinPath(prefix, path);
  if (UNSUPPORTED_EXPRESS_SYNTAX.test(path)) return [unrecognised(full, 'route path uses optional/wildcard/regexp syntax')];
  if (!isRecord(methods)) return [unrecognised(full, 'route has no methods map')];
  const names = Object.keys(methods).filter((name) => methods[name] === true);
  if (names.includes('_all')) return [unrecognised(full, 'router.all() route matches every method')];
  return names.map((name) => ({ method: name.toUpperCase(), path: full, key: routeKey(name, full) }));
}

/** Name of the function Express 5 wraps around a mounted sub-app (`express/lib/application.js`). */
const SUB_APP_HANDLER = 'mounted_app';

/** A path segment no literal mount path contains: a layer that also matches it has a parameter or wildcard there. */
const PROBE_SEGMENT = '__drift_probe__';

function layerMatches(layer: Readonly<Record<string, unknown>>, path: string): boolean {
  const { match } = layer;
  if (typeof match !== 'function') return false;
  try {
    return (match as (path: string) => unknown).call(layer, path) === true;
  } catch {
    return false; // A matcher that throws (undecodable parameter) does not match.
  }
}

/** `path` with the probe segment inserted before the segment at `index` (`segments` starts with the empty root segment). */
const withInsertedSegment = (segments: readonly string[], index: number): string => segments.toSpliced(index, 0, PROBE_SEGMENT).join('/');

/**
 * The mount path of a router layer mounted under a path, relative to `prefix`, when the layer matches one of the
 * candidate paths literally. Proven by probing the layer's own matcher:
 * - it has one matcher (an array mount such as `['/api/v1', '/hidden']` serves paths the walk would never see);
 * - it matches the candidate, and no variant with any one segment replaced by a probe segment (so `/api/:version` or
 *   `/*rest` is never taken for `/api/v1`);
 * - it matches no variant with a probe segment inserted before the last segment (`/api{/:v}/v1`), and a probe segment
 *   appended after the candidate leaves the matched path equal to the candidate (so `/api/v1{/:x}` and
 *   `/api/v1{*rest}`, which consume it, are rejected). A prefix mount (`/api` for `/api/v1`) fails the substitution probe.
 */
function resolveMountPath(layer: Readonly<Record<string, unknown>>, prefix: string, mountPaths: readonly string[]): string | undefined {
  if (!Array.isArray(layer.matchers) || layer.matchers.length !== 1) return undefined;
  for (const full of mountPaths) {
    if (prefix !== '' && !full.startsWith(`${prefix}/`)) continue;
    const relative = full.slice(prefix.length);
    if (!layerMatches(layer, relative)) continue;
    const segments = relative.split('/');
    const substituted = segments.some(
      (segment, index) => segment !== '' && layerMatches(layer, segments.map((s, i) => (i === index ? PROBE_SEGMENT : s)).join('/')),
    );
    const inserted = segments.slice(1).some((_segment, index) => layerMatches(layer, withInsertedSegment(segments, index + 1)));
    const consumesExtra = layerMatches(layer, `${relative}/${PROBE_SEGMENT}`) && layer.path !== relative;
    if (!substituted && !inserted && !consumesExtra) return relative;
  }
  return undefined;
}

function walk(router: unknown, prefix: string, depth: number, out: MountedRoute[], options: WalkOptions): void {
  const stack = isRecord(router) || typeof router === 'function' ? (router as { stack?: unknown }).stack : undefined;
  if (!Array.isArray(stack)) {
    out.push(unrecognised(prefix || '/', 'mounted value is not an Express router (no stack)'));
    return;
  }
  if (depth > MAX_ROUTER_DEPTH) {
    out.push(unrecognised(prefix || '/', `routers nested deeper than ${MAX_ROUTER_DEPTH}`));
    return;
  }
  for (const layer of stack as readonly unknown[]) {
    if (!isRecord(layer)) {
      out.push(unrecognised(prefix || '/', 'router stack entry is not a layer'));
      continue;
    }
    if (isRecord(layer.route)) {
      out.push(...routeLayer(prefix, layer.route));
      continue;
    }
    const handle = layer.handle;
    const isRouter = typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);
    if (layer.slash === true) {
      // Mounted without a path: a router is recursed; middleware (`router.use(fn)`) serves no route of its own, but an
      // Express sub-app (`use(express())`, wrapped as `mounted_app`) serves whatever it holds: never skipped.
      if (isRouter) walk(handle, prefix, depth + 1, out, options);
      else if (layer.name === SUB_APP_HANDLER) out.push(unrecognised(prefix || '/', 'Express sub-app mounted without a path'));
      continue;
    }
    if (!isRouter) {
      // `router.use('/webhooks/x', handler)` answers requests under that path: never skipped (PR #21 R1-M1).
      out.push(unrecognised(prefix || '/', `middleware "${String(layer.name)}" mounted under a path`));
      continue;
    }
    const mountPath = resolveMountPath(layer, prefix, options.mountPaths ?? []);
    if (mountPath === undefined) {
      out.push(unrecognised(prefix || '/', `nested router "${String(layer.name)}" mounted under a path`));
      continue;
    }
    const full = joinPath(prefix, mountPath);
    if (!(options.excluded ?? []).includes(full)) walk(handle, full, depth + 1, out, options);
  }
}

/**
 * Every route the routers serve, with the full path. `HEAD` implied by `GET` is not listed (Express answers it from
 * the GET route); an explicit `router.head()` is. Layers the walker cannot resolve are returned with `unrecognised`:
 * a router or a handler mounted under a path that is not one of `options.mountPaths`, arrays, RegExps, `all()` and
 * optional/wildcard paths. Middleware mounted without a path (`use(fn)`) is skipped by design: it serves no route.
 */
export function listMountedRoutes(mounts: readonly Mount[], options: WalkOptions = {}): MountedRoute[] {
  const out: MountedRoute[] = [];
  for (const { prefix, router } of mounts) walk(router, prefix, 0, out, options);
  return out;
}

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** A media-type map in which every entry has `example` or a non-empty `examples` map. */
function everyMediaTypeHasExample(content: unknown): boolean {
  if (!isRecord(content)) return true;
  return Object.values(content).every((media) => {
    if (!isRecord(media)) return false;
    if (media.example !== undefined) return true;
    return isRecord(media.examples) && Object.keys(media.examples).length > 0;
  });
}

function firstSuccessResponse(operation: OperationObject): { status: string; response: unknown } | undefined {
  const statuses = Object.keys(operation.responses ?? {})
    .filter((status) => /^2(?:\d\d|XX)$/.test(status))
    .sort();
  const status = statuses[0];
  return status === undefined ? undefined : { status, response: operation.responses?.[status] };
}

function exampleProblems(operation: OperationObject): string[] {
  const problems: string[] = [];
  const success = firstSuccessResponse(operation);
  // No 2xx (a redirect-only operation) or a 2xx without content (204) needs no response example.
  if (success !== undefined && isRecord(success.response) && !everyMediaTypeHasExample(success.response.content)) {
    problems.push(`response ${success.status} has no example`);
  }
  const body = operation.requestBody;
  if (body !== undefined && (!isRecord(body.content) || !everyMediaTypeHasExample(body.content))) {
    problems.push('request body has no example');
  }
  return problems;
}

function permissionProblem(operation: OperationObject): string | undefined {
  const permission = operation['x-permission'];
  if (!nonEmptyString(permission)) return 'no x-permission';
  if (ACCESS_KEYWORDS.has(permission) && !nonEmptyString(operation['x-permission-justification'])) {
    return `x-permission ${permission} without x-permission-justification`;
  }
  return undefined;
}

/** api/README.md §15 rule 7 (REQ-API-002): `x-requirements`, `x-milestone` and `x-moscow` on every operation. */
function traceabilityProblems(operation: OperationObject): string[] {
  const problems: string[] = [];
  const requirements = operation['x-requirements'];
  if (!Array.isArray(requirements) || requirements.length === 0) problems.push('no non-empty x-requirements');
  else {
    const invalid = requirements.filter((id) => typeof id !== 'string' || !REQUIREMENT_ID.test(id));
    if (invalid.length > 0) problems.push(`x-requirements entries are not REQ IDs: ${invalid.map(String).join(', ')}`);
  }
  const milestone = operation['x-milestone'];
  if (typeof milestone !== 'string' || !MILESTONE.test(milestone)) problems.push(`x-milestone ${String(milestone)} is not M0-M5`);
  const moscow = operation['x-moscow'];
  if (typeof moscow !== 'string' || !MOSCOW.has(moscow)) problems.push(`x-moscow ${String(moscow)} is not Must, Should or Could`);
  return problems;
}

function sunsetTime(operation: OperationObject): number | undefined {
  const sunset = operation['x-sunset'];
  const value = sunset instanceof Date ? sunset.getTime() : typeof sunset === 'string' ? Date.parse(sunset) : Number.NaN;
  return Number.isNaN(value) ? undefined : value;
}

function finding(rule: DriftRule, op: ContractOperation, message: string): DriftFinding {
  const operationId = op.operation.operationId;
  return { rule, method: op.method, path: op.fullPath, ...(operationId === undefined ? {} : { operationId }), message };
}

/** Rules on a documented operation alone (whether mounted or not). */
function operationFindings(op: ContractOperation, seenIds: ReadonlyMap<string, number>): DriftFinding[] {
  const out: DriftFinding[] = [];
  const { operation } = op;
  const id = operation.operationId;
  if (!nonEmptyString(id)) out.push(finding('operation-id', op, 'no operationId'));
  else if (!OPERATION_ID.test(id)) out.push(finding('operation-id', op, `operationId ${id} is not camelCase`));
  else if ((seenIds.get(id) ?? 0) > 1) out.push(finding('operation-id', op, `operationId ${id} is not unique`));

  for (const problem of exampleProblems(operation)) out.push(finding('missing-example', op, problem));
  const codes = operation['x-error-codes'];
  if (!Array.isArray(codes) || codes.length === 0) out.push(finding('missing-error-codes', op, 'no non-empty x-error-codes'));
  const permission = permissionProblem(operation);
  if (permission !== undefined) out.push(finding('missing-permission', op, permission));
  if (operation.deprecated === true && sunsetTime(operation) === undefined) {
    out.push(finding('deprecated-without-sunset', op, 'deprecated without a valid x-sunset date'));
  }
  for (const problem of traceabilityProblems(operation)) out.push(finding('missing-traceability', op, problem));
  return out;
}

/** Every drift finding; an empty list means the routes, the ledger and the document agree. */
export function checkContractDrift({ doc, mounted, implemented, now = new Date() }: DriftInput): DriftFinding[] {
  const operations = listOperations(doc);
  const seenIds = new Map<string, number>();
  for (const { operation } of operations) {
    if (operation.operationId !== undefined) seenIds.set(operation.operationId, (seenIds.get(operation.operationId) ?? 0) + 1);
  }
  const documented = new Map(operations.map((op) => [routeKey(op.method, op.fullPath), op]));
  const byId = new Map(operations.map((op) => [op.operationId, op]));
  const ledger = new Set(implemented);
  const mountedKeys = new Set<string>();
  const findings: DriftFinding[] = [];

  for (const route of mounted) {
    if (route.unrecognised !== undefined) {
      findings.push({ rule: 'unrecognised-route', method: route.method, path: route.path, message: route.unrecognised });
      continue;
    }
    if (mountedKeys.has(route.key)) continue;
    mountedKeys.add(route.key);
    const op = documented.get(route.key);
    if (op === undefined) {
      findings.push({ rule: 'undocumented-route', method: route.method, path: route.path, message: 'mounted but not in openapi.yaml' });
      continue;
    }
    if (!ledger.has(op.operationId)) {
      findings.push(finding('not-in-ledger', op, 'mounted and documented but not in implemented-operations.json'));
    }
    const sunset = op.operation.deprecated === true ? sunsetTime(op.operation) : undefined;
    if (sunset !== undefined && sunset <= now.getTime()) {
      findings.push(finding('sunset-passed', op, `x-sunset ${new Date(sunset).toISOString()} has passed while still mounted`));
    }
  }

  for (const id of ledger) {
    const op = byId.get(id);
    if (op === undefined) {
      findings.push({
        rule: 'unknown-ledger-entry',
        method: '*',
        path: '*',
        operationId: id,
        message: 'not an operationId in openapi.yaml',
      });
    } else if (!mountedKeys.has(routeKey(op.method, op.fullPath))) {
      findings.push(finding('not-mounted', op, 'in implemented-operations.json but not mounted'));
    }
  }

  for (const op of operations) findings.push(...operationFindings(op, seenIds));
  return findings;
}

export const formatFinding = (f: DriftFinding): string =>
  `${f.rule}: ${f.method} ${f.path}${f.operationId === undefined ? '' : ` (${f.operationId})`}: ${f.message}`;

/** Validates the ledger JSON: `{ "operations": [unique operationId strings] }`. */
export function parseLedger(json: unknown): string[] {
  const operations = isRecord(json) ? json.operations : undefined;
  if (!Array.isArray(operations) || !operations.every((id): id is string => typeof id === 'string' && OPERATION_ID.test(id))) {
    throw new Error('implemented-operations.json: "operations" must be an array of camelCase operationIds');
  }
  if (new Set(operations).size !== operations.length) throw new Error('implemented-operations.json: duplicate operationId');
  return operations;
}

export async function readLedger(path: string = LEDGER_PATH): Promise<string[]> {
  const json: unknown = JSON.parse(await readFile(path, 'utf8'));
  return parseLedger(json);
}
