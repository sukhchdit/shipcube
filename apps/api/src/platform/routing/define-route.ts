/**
 * Mandatory route metadata (US-067, REQ-RBAC-005, ADR-0003 "Route metadata", api/README §15; TASK-020). Every route of
 * the app is declared with `defineRoute`: method and path, the permission (catalogued, or the `public`/`authenticated`
 * marker with a justification), the audit descriptor (`x-audit`), Joi schemas with unknown fields rejected, the
 * rate-limit class, the idempotency mode, the tenancy and the authentication. `defineRoute` refuses an incomplete or
 * inconsistent declaration when the module loads, so a route missing metadata fails the build's tests before it can
 * be mounted, and `mountRoutes` (pipeline.ts) is the only way a handler reaches a router. Pure: no I/O.
 */
import {
  findRouteAuthSet,
  isPermission,
  isRouteAuth,
  isRouteMarker,
  type Permission,
  ROUTE_TENANCIES,
  type RouteAuth,
  routeAuthProblems,
  type RouteAuthSet,
  type RouteMarker,
  type RouteTenancy,
} from '@platform/authz';
import { AUDIT_ACTIONS, AUDIT_SENSITIVITIES, type AuditDescriptor } from '@platform/shared';
import Joi from 'joi';

import type { TenantContext } from '../db/index.js';
import { DeprecationConfigError, type DeprecationInfo, deprecationHeaderValues } from '../openapi/deprecation.js';

export const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

/** `x-idempotency` (api/README §5). */
export const IDEMPOTENCY_MODES = ['required', 'optional', 'not-applicable'] as const;
export type IdempotencyMode = (typeof IDEMPOTENCY_MODES)[number];

/** `x-rate-limit-class` (api/README §7, DR-A22). */
export const RATE_LIMIT_CLASSES = [
  'none',
  'public',
  'public-quote',
  'public-tracking',
  'auth',
  'authenticated',
  'email-send',
  'webhook',
  'csp-report',
] as const;
export type RateLimitClass = (typeof RATE_LIMIT_CLASSES)[number];

/** The four request parts a route validates; an absent schema means the part must be empty. */
export interface RouteSchemas {
  readonly params?: Joi.ObjectSchema;
  readonly query?: Joi.ObjectSchema;
  readonly body?: Joi.ObjectSchema;
  /** Declared request headers only (lower-case names); other headers are not projected into the input. */
  readonly headers?: Joi.ObjectSchema;
}

/** The validated, converted request parts handed to the handler; never the raw `req.body`/`req.query`. */
export interface RouteInput {
  readonly params: Readonly<Record<string, unknown>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly body: Readonly<Record<string, unknown>> | undefined;
  readonly headers: Readonly<Record<string, unknown>>;
}

/**
 * Who calls (authn slot). Anonymous until the authenticators land (TASK-052/055/091/171/261); fields mirror
 * TenantContext. `credential` is the kind that authenticated the request (D-ARCH-107 (4)); `authenticated` means a
 * user actor, so a `quote-token` guest and a `signature` provider have `authenticated: false` and no actor.
 */
export interface Principal {
  readonly credential: RouteAuth;
  readonly authenticated: boolean;
  readonly actorId: string;
  readonly orgId: string;
  readonly actorScope: TenantContext['actorScope'];
  readonly guestTokenHash: string;
  /** Effective permissions in the active organisation (live resolution is TASK-060). */
  readonly permissions: ReadonlySet<string>;
}

/** The handler's response; the pipeline sends it after the transaction committed, so a rollback never sends 2xx. */
export interface RouteResult {
  readonly status: number;
  /** JSON body; omit for 204/304. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The transport details a handler may read (the client IP and user agent for audit, TASK-029), frozen. Never the live
 * request or response: a handler that could write through `req.res` would answer before COMMIT (PR32-SEC-05 (c)).
 */
export interface RouteTransport {
  readonly ip: string;
  readonly userAgent: string;
}

export interface RouteContext {
  readonly route: RouteDescriptor;
  readonly input: RouteInput;
  readonly principal: Principal;
  readonly correlationId: string;
  /** The guarded TenantDb of the request's transaction (tx slot); undefined on `transaction: 'none'` routes. */
  readonly db: unknown;
  readonly transport: RouteTransport;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult> | RouteResult;

type RoutePermission =
  | { readonly permission: Permission; readonly permissionJustification?: undefined }
  | { readonly permission: RouteMarker; readonly permissionJustification: string };

export type RouteSpec = RoutePermission & {
  /** openapi.yaml operationId (camelCase); the route-metadata test pairs routes and operations by it. */
  readonly operationId: string;
  readonly method: RouteMethod;
  /** Express path relative to the mount (`/shipments/:shipmentId`); literal segments and `:name` parameters only. */
  readonly path: string;
  readonly audit: AuditDescriptor;
  readonly schema: RouteSchemas;
  readonly rateLimit: RateLimitClass;
  /** `x-rate-limit-route`: the route-specific limit text of the contract, when it has one. */
  readonly rateLimitRoute?: string;
  readonly idempotency: IdempotencyMode;
  readonly tenancy: RouteTenancy;
  /**
   * The credential kinds the route accepts (D-ARCH-107 (1)): one kind (sugar for a set of one) or one of the accepted
   * sets (`ROUTE_AUTH_SETS`, order-insensitive), the contract's `security` alternatives one to one.
   */
  readonly auth: RouteAuth | readonly RouteAuth[];
  /**
   * `x-permission-authenticated` (D-ARCH-107 (2)): on a dual-mode route (`public` with `[anonymous, session]` or
   * `[session, quote-token]`) and only there, the permission a `session` caller must hold.
   */
  readonly permissionAuthenticated?: Permission;
  /** `x-reauth-scope` / `x-reauth-max-age` (ADR-0006 amendment, SEC-P3-01). */
  readonly reauth?: { readonly scope: string; readonly maxAgeSeconds?: number };
  /** Deprecated (REQ-API-015): the pipeline sends Deprecation, Sunset and Link on every response of the route. */
  readonly deprecated?: DeprecationInfo;
  readonly mfaGateExempt?: true;
  readonly csrf?: true;
  /**
   * `tenant` (default): the handler runs inside one `withTenantTx` with the audit entry (DR-A08). `none`: no database
   * transaction (health, docs-like routes); such a route may not reach the database at all.
   */
  readonly transaction?: 'tenant' | 'none';
  readonly handler: RouteHandler;
};

type WithoutAuth<T> = T extends unknown ? Omit<T, 'auth'> : never;

/** A validated, frozen route declaration; `auth` is normalised to the frozen accepted set, in canonical order. */
export type RouteDescriptor = Readonly<WithoutAuth<RouteSpec>> & {
  readonly auth: RouteAuthSet;
  readonly transaction: 'tenant' | 'none';
  readonly pathParams: readonly string[];
};

export class RouteDefinitionError extends Error {
  constructor(spec: { readonly method?: unknown; readonly path?: unknown; readonly operationId?: unknown }, problems: readonly string[]) {
    super(`defineRoute ${String(spec.method).toUpperCase()} ${String(spec.path)} (${String(spec.operationId)}): ${problems.join('; ')}`);
    this.name = 'RouteDefinitionError';
  }
}

const OPERATION_ID = /^[a-z][a-zA-Z0-9]{0,127}$/;
/** Literal segments (`[a-z0-9._-]`) and `:camelCase` parameters; no optional groups, wildcards or regexp syntax. */
const PATH_SEGMENT = /^(?:[a-z0-9][a-z0-9._-]*|:[a-z][a-zA-Z0-9]*)$/;
const REAUTH_SCOPE = /^[a-z_]+(?:\.[a-z_]+)+$/;
const MAX_PATH_LENGTH = 512;

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => (values as readonly unknown[]).includes(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** The `:name` parameters of an Express path, in order. */
export function pathParameters(path: string): string[] {
  return path
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

function pathProblems(path: unknown): string[] {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length > MAX_PATH_LENGTH) return ['path must be an absolute string path'];
  if (path === '/') return [];
  const segments = path.slice(1).split('/');
  const bad = segments.filter((segment) => !PATH_SEGMENT.test(segment));
  if (bad.length > 0) return [`path segments ${bad.map((s) => JSON.stringify(s)).join(', ')} are not literal or :param`];
  const params = pathParameters(path);
  return new Set(params).size === params.length ? [] : ['path repeats a parameter name'];
}

function permissionProblems(spec: RouteSpec): string[] {
  const { permission, permissionJustification } = spec;
  if (isRouteMarker(permission)) return nonEmpty(permissionJustification) ? [] : [`marker "${permission}" needs a permissionJustification`];
  if (!isPermission(permission)) return [`permission "${String(permission)}" is not in the catalogue`];
  return permissionJustification === undefined ? [] : ['permissionJustification is only allowed on a public/authenticated marker'];
}

/** The descriptor read as untrusted data: the type rules out these mistakes, the check also covers JavaScript callers. */
interface LooseAudit {
  readonly action?: unknown;
  readonly sensitivity?: unknown;
  readonly entity?: unknown;
  readonly justification?: unknown;
}

function auditProblems(descriptor: AuditDescriptor | undefined): string[] {
  if (descriptor === undefined) return ['audit descriptor is missing'];
  const audit: LooseAudit = descriptor;
  const problems: string[] = [];
  if (!isOneOf(AUDIT_ACTIONS, audit.action)) problems.push(`audit action "${String(audit.action)}" is unknown`);
  if (!isOneOf(AUDIT_SENSITIVITIES, audit.sensitivity)) problems.push(`audit sensitivity "${String(audit.sensitivity)}" is unknown`);
  if (audit.action === 'NONE') {
    if (!nonEmpty(audit.justification)) problems.push('audit action NONE needs a justification (REQ-AUDIT-006)');
    if (audit.sensitivity !== 'NONE' || audit.entity !== null) problems.push('audit action NONE has sensitivity NONE and entity null');
  } else if (audit.sensitivity === 'NONE') problems.push(`audit action ${String(audit.action)} cannot have sensitivity NONE`);
  return problems;
}

/** The parts of Joi's `describe()` output the closed-schema walk reads. */
interface SchemaNode {
  readonly type?: unknown;
  readonly flags?: { readonly unknown?: unknown; readonly only?: unknown };
  readonly keys?: Readonly<Record<string, SchemaNode>>;
  readonly patterns?: readonly unknown[];
  readonly items?: readonly SchemaNode[];
  readonly ordered?: readonly SchemaNode[];
  readonly matches?: readonly Branches[];
  readonly whens?: readonly Branches[];
}
interface Branches {
  readonly schema?: SchemaNode;
  readonly then?: SchemaNode;
  readonly otherwise?: SchemaNode;
  readonly switch?: readonly Branches[];
}

/** Deeper request schemas are refused rather than walked (bounded work at module load). */
const MAX_SCHEMA_DEPTH = 32;

function branchNodes(branches: readonly Branches[] | undefined): SchemaNode[] {
  const nodes: SchemaNode[] = [];
  for (const branch of branches ?? []) {
    for (const node of [branch.schema, branch.then, branch.otherwise]) if (node !== undefined) nodes.push(node);
    nodes.push(...branchNodes(branch.switch));
  }
  return nodes;
}

/**
 * Closed at every depth (REQ-SEC-007, PR #32 m8, PR32-SEC-04): every object declares its keys (possibly none) and
 * neither allows unknown keys nor has key patterns; every array declares its items; an `any` value is an explicit
 * allow-list (`valid`); alternatives and conditional branches are walked like any other node.
 */
function openSchemaProblems(node: SchemaNode, where: string, depth: number): string[] {
  if (depth > MAX_SCHEMA_DEPTH) return [`${where} is nested deeper than ${String(MAX_SCHEMA_DEPTH)} levels`];
  const problems: string[] = [];
  if (node.type === 'object') {
    if (node.keys === undefined) problems.push(`${where} declares no keys (an open object)`);
    if (node.flags?.unknown === true) problems.push(`${where} allows unknown keys`);
    if (node.patterns !== undefined && node.patterns.length > 0) problems.push(`${where} has key patterns`);
  } else if (node.type === 'array' && node.items === undefined && node.ordered === undefined) {
    problems.push(`${where} declares no items`);
  } else if (node.type === 'any' && node.flags?.only !== true) problems.push(`${where} is Joi.any() without an allow-list`);
  for (const [key, child] of Object.entries(node.keys ?? {})) problems.push(...openSchemaProblems(child, `${where}.${key}`, depth + 1));
  for (const child of [...(node.items ?? []), ...(node.ordered ?? [])])
    problems.push(...openSchemaProblems(child, `${where}[]`, depth + 1));
  for (const child of [...branchNodes(node.matches), ...branchNodes(node.whens)])
    problems.push(...openSchemaProblems(child, where, depth + 1));
  return problems;
}

/** Joi schemas must be closed objects at every depth (REQ-SEC-007). */
function schemaProblems(spec: RouteSpec): string[] {
  const problems: string[] = [];
  for (const [part, schema] of Object.entries(spec.schema) as [keyof RouteSchemas, Joi.Schema | undefined][]) {
    if (schema === undefined) continue;
    if (!Joi.isSchema(schema) || schema.type !== 'object') {
      problems.push(`schema.${part} must be a Joi object schema`);
      continue;
    }
    problems.push(...openSchemaProblems(schema.describe(), `schema.${part}`, 0));
  }
  const declared = spec.schema.params === undefined ? [] : Object.keys((spec.schema.params.describe() as { keys?: object }).keys ?? {});
  const expected = pathParameters(typeof spec.path === 'string' ? spec.path : '');
  if (declared.slice().sort().join(',') !== expected.slice().sort().join(',')) {
    problems.push(`schema.params keys [${declared.join(', ')}] differ from the path parameters [${expected.join(', ')}]`);
  }
  return problems;
}

function deprecationProblems(info: DeprecationInfo): string[] {
  try {
    deprecationHeaderValues(info);
    return [];
  } catch (error) {
    // The configuration error text names the bad field only (deprecation.ts); kept as its own problem entry.
    if (error instanceof DeprecationConfigError) return ['deprecated metadata is invalid', error.message];
    throw error;
  }
}

function optionProblems(spec: RouteSpec): string[] {
  const problems: string[] = [];
  if (spec.reauth !== undefined) {
    if (!REAUTH_SCOPE.test(spec.reauth.scope)) problems.push(`reauth scope "${spec.reauth.scope}" is not dotted lower-case`);
    const age = spec.reauth.maxAgeSeconds;
    if (age !== undefined && (!Number.isSafeInteger(age) || age <= 0)) problems.push('reauth maxAgeSeconds must be a positive integer');
  }
  if (spec.deprecated !== undefined) problems.push(...deprecationProblems(spec.deprecated));
  if (spec.transaction !== undefined && spec.transaction !== 'tenant' && spec.transaction !== 'none') {
    problems.push('transaction must be tenant or none');
  }
  if (spec.transaction === 'none' && spec.tenancy !== 'public') problems.push('transaction none is only allowed on public-tenancy routes');
  // D-ARCH-106 (6), PR32-SEC-05 (d): without a transaction the audit hook has no database handle (O4).
  if (spec.transaction === 'none' && (spec.audit as AuditDescriptor | undefined)?.action !== 'NONE') {
    problems.push('transaction none is only allowed with audit action NONE');
  }
  if (spec.rateLimitRoute !== undefined && !nonEmpty(spec.rateLimitRoute)) problems.push('rateLimitRoute must be non-empty when set');
  if (typeof spec.handler !== 'function') problems.push('handler is not a function');
  return problems;
}

/** `auth` as written: one kind (sugar) or a set; JavaScript callers may pass anything. */
const authKinds = (auth: unknown): readonly unknown[] => (Array.isArray(auth) ? (auth as readonly unknown[]) : [auth]);

/**
 * D-ARCH-107 (1)-(3) at module load: every kind is known, the set is one of `ROUTE_AUTH_SETS`, a catalogued or
 * `authenticated` permission is reached by `[session]` only (PR #32 m7), `permissionAuthenticated` is declared exactly
 * on a dual-mode route and is a catalogued tenant permission, and an unsafe refresh-cookie route checks CSRF. The
 * tenancy and signature bindings (PR8-SEC-05) stay with the boot check and the route-metadata test.
 */
function authProblems(spec: RouteSpec): string[] {
  const kinds = authKinds(spec.auth);
  const unknown = kinds.filter((kind) => !isRouteAuth(kind));
  if (unknown.length > 0) return [`auth ${unknown.map((kind) => `"${String(kind)}"`).join(', ')} is unknown`];
  return routeAuthProblems({
    method: String(spec.method),
    permission: String(spec.permission),
    auth: kinds,
    permissionAuthenticated: spec.permissionAuthenticated,
    csrf: spec.csrf,
  }).map(([, message]) => message);
}

/** Every problem of a route declaration; empty means `defineRoute` accepts it. Exported for the negative tests. */
export function routeDefinitionProblems(spec: RouteSpec): string[] {
  const problems: string[] = [];
  if (!OPERATION_ID.test(String(spec.operationId))) problems.push('operationId must be camelCase');
  if (!isOneOf(ROUTE_METHODS, spec.method)) problems.push(`method "${String(spec.method)}" is not one of ${ROUTE_METHODS.join(', ')}`);
  problems.push(...pathProblems(spec.path), ...permissionProblems(spec), ...auditProblems(spec.audit));
  if (!isOneOf(RATE_LIMIT_CLASSES, spec.rateLimit)) problems.push(`rateLimit "${String(spec.rateLimit)}" is not a class`);
  if (!isOneOf(IDEMPOTENCY_MODES, spec.idempotency)) problems.push(`idempotency "${String(spec.idempotency)}" is not a mode`);
  if (!isOneOf(ROUTE_TENANCIES, spec.tenancy)) problems.push(`tenancy "${String(spec.tenancy)}" is unknown`);
  problems.push(...authProblems(spec));
  if (typeof spec.schema !== 'object' || spec.schema === null) problems.push('schema is missing');
  else problems.push(...schemaProblems(spec));
  problems.push(...optionProblems(spec));
  return problems;
}

/**
 * Every descriptor `defineRoute` returned (PR #32 m2, PR32-SEC-05 (a)). Module-private: an object built by hand or by
 * spreading a descriptor (`{ ...route, transaction: 'none' }`) is not in it, so `mountRoutes` refuses it instead of
 * mounting a route whose invariants nobody checked. Weak, so test apps do not leak.
 */
const DEFINED = new WeakSet<object>();

/** True for a descriptor returned by `defineRoute` (the brand `mountRoutes` requires). */
export function isDefinedRoute(value: unknown): value is RouteDescriptor {
  return typeof value === 'object' && value !== null && DEFINED.has(value);
}

/** Declares one route. Throws `RouteDefinitionError` naming every problem; returns the frozen descriptor. */
export function defineRoute(spec: RouteSpec): RouteDescriptor {
  const problems = routeDefinitionProblems(spec);
  if (problems.length > 0) throw new RouteDefinitionError(spec, problems);
  const descriptor: RouteDescriptor = Object.freeze({
    ...spec,
    schema: Object.freeze({ ...spec.schema }),
    // Checked above: the accepted set, frozen and in canonical order (D-ARCH-107 (1)).
    auth: findRouteAuthSet(authKinds(spec.auth)) ?? [],
    transaction: spec.transaction ?? 'tenant',
    pathParams: Object.freeze(pathParameters(spec.path)),
  });
  DEFINED.add(descriptor);
  return descriptor;
}
