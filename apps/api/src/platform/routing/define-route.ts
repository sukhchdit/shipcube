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
import { AUDIT_ACTIONS, AUDIT_SENSITIVITIES, type AuditDescriptor, CREDENTIAL_HEADER_NAMES } from '@platform/shared';
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

/** Where a stream result writes its body: chunks only, never the status line or headers (already sent). */
export interface RouteStreamSink {
  write(chunk: string): void;
}

/**
 * A result whose body is produced after COMMIT (TASK-020 part 020-C (f), the stream hook; ADR-0003 amendment
 * 2026-11-13 (e)). The tx slot sends the status line and headers, then awaits `complete` and ends the response; the
 * result type and the SSE framing are TASK-044's. `signal` aborts at the request deadline or when the client goes.
 */
export interface RouteStream {
  complete(sink: RouteStreamSink, signal: AbortSignal): Promise<void>;
}

/** The handler's response; the pipeline sends it after the transaction committed, so a rollback never sends 2xx. */
export interface RouteResult {
  readonly status: number;
  /** JSON body; omit for 204/304 and for a stream result. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** A body completed after COMMIT (see `RouteStream`); exclusive with `body`. */
  readonly stream?: RouteStream;
}

/**
 * The transport details a handler may read (the client IP and user agent for audit, TASK-029), frozen. Never the live
 * request or response: a handler that could write through `req.res` would answer before COMMIT (PR32-SEC-05 (c)).
 */
export interface RouteTransport {
  readonly ip: string;
  readonly userAgent: string;
}

/**
 * What every phase reads about the request (ADR-0003 amendment 2026-11-13): the descriptor, the validated input, the
 * principal, the correlation id and the frozen transport view, never the live request or response (PR32-SEC-05 (c)).
 */
export interface RouteRequestContext {
  readonly route: RouteDescriptor;
  readonly input: RouteInput;
  readonly principal: Principal;
  readonly correlationId: string;
  readonly transport: RouteTransport;
}

/** The context of `load` and `handler`: the request plus the guarded TenantDb of the phase's own transaction. */
export interface RouteContext extends RouteRequestContext {
  /**
   * The guarded TenantDb of the phase's transaction (tx slot): read-only in `load`, the one write transaction in
   * `handler`; undefined on `transaction: 'none'` routes.
   */
  readonly db: unknown;
}

/**
 * The context of `call` (D-ARCH-106 (4)): no transaction and no database handle. `signal` aborts at the request
 * deadline or when the client disconnects; pass it to every external call.
 */
export interface CallContext extends RouteRequestContext {
  readonly signal: AbortSignal;
}

/** What `handler` receives from the earlier phases: `undefined` for a phase the route does not declare. */
export interface PhaseResults<L, C> {
  readonly loaded: L;
  readonly called: C;
}

/**
 * `load(ctx)` (ADR-0003 amendment 2026-11-13): one short READ-ONLY tenant transaction (a write fails with SQLSTATE
 * 25006) that resolves the addressed resource under RLS and reads what `call` needs; returns plain data, writes nothing
 * and records no audit entry. A tenant-transaction root of the T-83 lint (R4).
 */
export type RouteLoad<L> = (ctx: RouteContext) => Promise<L> | L;
/**
 * `call(ctx, loaded)`: the only place for external I/O (HTTP, queue, Valkey, object storage, SMTP) and heavy CPU, with
 * no transaction open. Every external effect carries an idempotency key derived from `loaded`, never a random value, so
 * a repeat after a failed handler transaction produces the effect once (ADR-0014 G3).
 */
export type RouteCall<L, C> = (ctx: CallContext, loaded: L) => Promise<C> | C;
/** `handler(ctx, { loaded, called })`: the one write transaction, with the audit hook; re-validates what `load` read. */
export type RouteHandler<L = undefined, C = undefined> = (
  ctx: RouteContext,
  phases: PhaseResults<L, C>,
) => Promise<RouteResult> | RouteResult;
/**
 * `afterCommit(ctx, result)`: after COMMIT and after the response was written, with no transaction and no database
 * handle. Best effort and in-process (durable work is an outbox event): a throw is logged as `api.after_commit_failed`
 * and never changes the response; pending work is drained at shutdown.
 */
export type RouteAfterCommit = (ctx: RouteRequestContext, result: RouteResult) => Promise<void> | void;

/** The route I/O phases (ADR-0003 amendment 2026-11-13, D-ARCH-106 (4)); a route with only `handler` is one transaction. */
export interface RoutePhases<L, C> {
  readonly load?: RouteLoad<L>;
  readonly call?: RouteCall<L, C>;
  readonly handler: RouteHandler<L, C>;
  readonly afterCommit?: RouteAfterCommit;
}

/**
 * The phases of a descriptor with their result types erased: `never` parameters accept every typed phase, and the tx
 * slot (the one caller) hands each phase's own result to the next.
 */
export interface DescriptorPhases {
  readonly load?: (ctx: RouteContext) => unknown;
  readonly call?: (ctx: CallContext, loaded: never) => unknown;
  readonly handler: (ctx: RouteContext, phases: PhaseResults<never, never>) => Promise<RouteResult> | RouteResult;
  readonly afterCommit?: RouteAfterCommit;
}

type RoutePermission =
  | { readonly permission: Permission; readonly permissionJustification?: undefined }
  | { readonly permission: RouteMarker; readonly permissionJustification: string };

/** Every field of a route declaration except the phases. */
type RouteDeclaration = RoutePermission & {
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
   * `tenant` (default): the handler runs inside one `withTenantTx` with the audit entry (DR-A08), after the optional
   * read-only `load` transaction and the transaction-free `call`. `none`: no database transaction (health, docs-like
   * routes); such a route may not reach the database at all and declares only `handler` and `afterCommit`.
   */
  readonly transaction?: 'tenant' | 'none';
};

/**
 * A route declaration (ADR-0003 "Route metadata", amendment 2026-11-13 (g)): `defineRoute` infers `L` from `load` and
 * `C` from `call`; a route without them has `undefined` results.
 */
export type RouteSpec<L = undefined, C = undefined> = RouteDeclaration & RoutePhases<L, C>;

type WithoutAuth<T> = T extends unknown ? Omit<T, 'auth'> : never;

/** A declaration as the checks read it: untrusted data, the phases as unknown values (JavaScript callers included). */
type CheckedSpec = RouteDeclaration & { readonly [phase in (typeof PHASES)[number]]?: unknown };

/** A validated, frozen route declaration; `auth` is normalised to the frozen accepted set, in canonical order. */
export type RouteDescriptor = Readonly<WithoutAuth<RouteDeclaration>> &
  DescriptorPhases & {
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

function permissionProblems(spec: CheckedSpec): string[] {
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
  /** Schema-level `prefs()`/`options()`: they override the options the validate slot passes (PR32-SEC-13). */
  readonly preferences?: { readonly allowUnknown?: unknown };
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
 * Joi's built-in type definitions, read from the default root (`Joi.types()`): the allow-list of schema
 * implementations a request schema may use (PR32-SEC-13). A `Joi.extend` type has its own definition and runs code
 * (`coerce`, `prepare`, `validate`, rules) that `describe()` does not show, even when it reuses a built-in name such as
 * `object`, so it is refused unless its definition is reviewed into this map. None is today.
 */
const definitionOf = (schema: object): unknown => (schema as { _definition?: unknown })._definition;
const BUILT_IN_DEFINITIONS: ReadonlyMap<string, unknown> = new Map(
  Object.values(Joi.types() as Record<string, Joi.Schema>).map((schema) => [String(schema.type), definitionOf(schema)]),
);
/** Joi keeps a schema's children in `$_terms` (its extension API): key, item, branch, condition and shared schemas. */
const termsOf = (schema: object): unknown => (schema as { $_terms?: unknown }).$_terms;
/** Bounds the `$_terms` walk; several term levels make one schema level (terms -> keys -> entry -> schema). */
const MAX_TERM_DEPTH = 4 * MAX_SCHEMA_DEPTH;
const isPlainObject = (value: object): boolean => Object.getPrototypeOf(value) === Object.prototype;
/**
 * The prototype of Joi's own object-dependency entries (`with`, `without`, `xor`, `and`, `or`, `nand`, `oxor`):
 * read from the default root, like the built-in definitions. Undefined if a Joi upgrade changes the shape, in which case
 * such entries are reported like any other unknown class instance (fail closed).
 */
const JOI_DEPENDENCY_PROTOTYPE: unknown = ((): unknown => {
  const terms = termsOf(Joi.object({ a: Joi.any(), b: Joi.any() }).with('a', 'b'));
  const entry: unknown = (terms as { dependencies?: readonly unknown[] } | undefined)?.dependencies?.[0];
  return typeof entry === 'object' && entry !== null && !isPlainObject(entry) ? Object.getPrototypeOf(entry) : undefined;
})();

/**
 * Every schema reachable from `root` is built on a built-in definition (PR32-SEC-13, `Joi.extend`; exported for its unit
 * tests, PR32-SEC-17). The walk follows schemas, arrays, plain objects and Joi's own dependency entries inside
 * `$_terms`, each object once; a `RegExp` and a Joi reference are leaves. Fails closed on everything it cannot walk
 * (D-ARCH-113 (4), PR38-SEC-04): a schema whose `$_terms` is missing or is not a plain object (a null-prototype copy, a
 * Map, a class instance) is reported and not walked, and any other non-plain object inside `$_terms` is reported rather
 * than skipped, so a Joi upgrade that moves children into another container fails the tests instead of opening.
 */
export function extensionProblems(root: Joi.Schema, where: string): string[] {
  const seen = new Set<object>();
  const problems = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    if (depth > MAX_TERM_DEPTH) {
      problems.add(`${where} is nested too deeply to inspect`);
      return;
    }
    seen.add(value);
    if (Joi.isSchema(value)) {
      const definition = definitionOf(value);
      if (definition === undefined || definition !== BUILT_IN_DEFINITIONS.get(String(value.type))) {
        problems.add(`${where} uses the Joi extension type "${String(value.type)}" (Joi.extend types are not allow-listed)`);
      }
      const terms = termsOf(value);
      if (typeof terms !== 'object' || terms === null) {
        problems.add(`${where} has a Joi schema without $_terms; its children cannot be inspected (Joi internals changed)`);
        return;
      }
      if (!isPlainObject(terms)) {
        problems.add(`${where} has a Joi schema whose $_terms cannot be inspected (Joi internals changed)`);
        return;
      }
      visit(terms, depth + 1);
    } else if (Array.isArray(value)) {
      for (const item of value as readonly unknown[]) visit(item, depth + 1);
    } else if (isPlainObject(value) || Object.getPrototypeOf(value) === JOI_DEPENDENCY_PROTOTYPE) {
      for (const item of Object.values(value)) visit(item, depth + 1);
    } else if (!(value instanceof RegExp) && !Joi.isRef(value)) {
      problems.add(`${where} holds a non-plain object inside $_terms that cannot be inspected (Joi internals changed)`);
    }
  };
  visit(root, 0);
  return [...problems];
}

/**
 * Closed at every depth (REQ-SEC-007, PR #32 m8, PR32-SEC-04, PR32-SEC-13): every object declares its keys (possibly
 * none) and neither allows unknown keys nor has key patterns; no node re-opens unknown keys through its own
 * `prefs()`/`options()` (they override the validate slot's options); every array declares its items; an `any` value
 * is an explicit allow-list (`valid`); a `Joi.link` is refused rather than resolved (declare the schema inline); a
 * type outside Joi's built-ins is refused; alternatives and conditional branches are walked like any other node.
 */
function openSchemaProblems(node: SchemaNode, where: string, depth: number): string[] {
  if (depth > MAX_SCHEMA_DEPTH) return [`${where} is nested deeper than ${String(MAX_SCHEMA_DEPTH)} levels`];
  if (node.type === 'link') return [`${where} is a Joi.link (indirection is not walked; declare the schema inline)`];
  if (typeof node.type !== 'string' || !BUILT_IN_DEFINITIONS.has(node.type)) {
    return [`${where} has the non-built-in Joi type "${String(node.type)}" (Joi.extend types are not allow-listed)`];
  }
  const problems: string[] = [];
  const allowUnknown = node.preferences?.allowUnknown;
  if (allowUnknown !== undefined && allowUnknown !== false) problems.push(`${where} re-opens unknown keys with prefs/options allowUnknown`);
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
function schemaProblems(spec: CheckedSpec): string[] {
  const problems: string[] = [];
  for (const [part, schema] of Object.entries(spec.schema) as [keyof RouteSchemas, Joi.Schema | undefined][]) {
    if (schema === undefined) continue;
    if (!Joi.isSchema(schema) || schema.type !== 'object') {
      problems.push(`schema.${part} must be a Joi object schema`);
      continue;
    }
    problems.push(...openSchemaProblems(schema.describe(), `schema.${part}`, 0), ...extensionProblems(schema, `schema.${part}`));
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

function optionProblems(spec: CheckedSpec): string[] {
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
  return problems;
}

const PHASES = ['load', 'call', 'handler', 'afterCommit'] as const;

/**
 * ADR-0003 amendment 2026-11-13 (a), D-ARCH-106 (4): every declared phase is a function and `handler` is required;
 * `load` without `call` is refused (the handler's own transaction can read); `transaction: 'none'` allows only
 * `handler` and `afterCommit` (no transaction for `load`, and `call` exists to keep I/O out of one).
 */
function phaseProblems(spec: CheckedSpec): string[] {
  const problems: string[] = [];
  for (const phase of PHASES) {
    const value = spec[phase];
    if (typeof value !== 'function' && (phase === 'handler' || value !== undefined)) problems.push(`${phase} is not a function`);
  }
  if (spec.load !== undefined && spec.call === undefined)
    problems.push('load without call is refused: the handler transaction can read (D-ARCH-106)');
  if (spec.transaction === 'none' && (spec.load !== undefined || spec.call !== undefined)) {
    problems.push('transaction none allows only handler and afterCommit (D-ARCH-106)');
  }
  return problems;
}

/** The one `auth` set on which `x-quote-token` is a legal companion header (ADR-0008 am. 5 item 1, am. 6 item 1). */
const QUOTE_TOKEN_COMPANION_AUTH = 'session';

/**
 * D-ARCH-113 (1), PR38-SEC-03: a credential never reaches a handler as validated input. `schema.headers` may not name
 * a `CREDENTIAL_HEADER_NAMES` entry (keys compared case-insensitively), with one exception: `x-quote-token` on a
 * route whose `auth` is exactly `[session]` (the companion of claimQuote, saveQuote and createShipment, where the
 * contract declares the QuoteToken header parameter; the handler compares hashes in constant time, never logs it).
 */
function credentialHeaderProblems(spec: CheckedSpec): string[] {
  const headers = spec.schema.headers;
  if (headers === undefined || !Joi.isSchema(headers)) return [];
  const keys = Object.keys((headers.describe() as { keys?: object }).keys ?? {});
  const kinds = authKinds(spec.auth);
  const companion = kinds.length === 1 && kinds[0] === QUOTE_TOKEN_COMPANION_AUTH;
  const refused = keys.filter((key) => {
    const name = key.toLowerCase();
    if (!(CREDENTIAL_HEADER_NAMES as readonly string[]).includes(name)) return false;
    return !(name === 'x-quote-token' && companion);
  });
  return refused.map(
    (key) =>
      `schema.headers declares the credential header "${key}": credentials are read by the authn slot only, never projected into a handler's input (x-quote-token only as the companion of auth [session]; D-ARCH-113)`,
  );
}

/** `auth` as written: one kind (sugar) or a set; JavaScript callers may pass anything. */
const authKinds = (auth: unknown): readonly unknown[] => (Array.isArray(auth) ? (auth as readonly unknown[]) : [auth]);

/**
 * D-ARCH-107 (1)-(3) at module load: every kind is known, the set is one of `ROUTE_AUTH_SETS`, a catalogued or
 * `authenticated` permission is reached by `[session]` only (PR #32 m7), `permissionAuthenticated` is declared exactly
 * on a dual-mode route and is a catalogued tenant permission, and an unsafe refresh-cookie route checks CSRF. The
 * tenancy and signature bindings (PR8-SEC-05) stay with the boot check and the route-metadata test.
 */
function authProblems(spec: CheckedSpec): string[] {
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
export function routeDefinitionProblems<L, C>(declared: RouteSpec<L, C>): string[] {
  const spec: CheckedSpec = declared;
  const problems: string[] = [];
  if (!OPERATION_ID.test(String(spec.operationId))) problems.push('operationId must be camelCase');
  if (!isOneOf(ROUTE_METHODS, spec.method)) problems.push(`method "${String(spec.method)}" is not one of ${ROUTE_METHODS.join(', ')}`);
  problems.push(...pathProblems(spec.path), ...permissionProblems(spec), ...auditProblems(spec.audit));
  if (!isOneOf(RATE_LIMIT_CLASSES, spec.rateLimit)) problems.push(`rateLimit "${String(spec.rateLimit)}" is not a class`);
  if (!isOneOf(IDEMPOTENCY_MODES, spec.idempotency)) problems.push(`idempotency "${String(spec.idempotency)}" is not a mode`);
  if (!isOneOf(ROUTE_TENANCIES, spec.tenancy)) problems.push(`tenancy "${String(spec.tenancy)}" is unknown`);
  problems.push(...authProblems(spec));
  if (typeof spec.schema !== 'object' || spec.schema === null) problems.push('schema is missing');
  else problems.push(...schemaProblems(spec), ...credentialHeaderProblems(spec));
  problems.push(...optionProblems(spec), ...phaseProblems(spec));
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

/**
 * A deep-frozen copy of plain declaration data (objects and arrays of primitives): the descriptor's nested `audit`
 * (with `additional`), `reauth` and `deprecated` cannot be changed after the checks ran (PR32-SEC-15, code review R2-n1).
 */
function frozenData<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const copy: unknown = Array.isArray(value)
    ? (value as readonly unknown[]).map((item) => frozenData(item))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenData(item)]));
  return Object.freeze(copy) as T;
}

/**
 * Declares one route. Throws `RouteDefinitionError` naming every problem; returns the deep-frozen descriptor. `L` and
 * `C` are inferred from `load` and `call` (ADR-0003 amendment 2026-11-13 (g)).
 */
export function defineRoute<L = undefined, C = undefined>(spec: RouteSpec<L, C>): RouteDescriptor {
  const problems = routeDefinitionProblems(spec);
  if (problems.length > 0) throw new RouteDefinitionError(spec, problems);
  const descriptor: RouteDescriptor = Object.freeze({
    ...spec,
    audit: frozenData(spec.audit),
    ...(spec.reauth === undefined ? {} : { reauth: frozenData(spec.reauth) }),
    ...(spec.deprecated === undefined ? {} : { deprecated: frozenData(spec.deprecated) }),
    schema: Object.freeze({ ...spec.schema }),
    // Checked above: the accepted set, frozen and in canonical order (D-ARCH-107 (1)).
    auth: findRouteAuthSet(authKinds(spec.auth)) ?? [],
    transaction: spec.transaction ?? 'tenant',
    pathParams: Object.freeze(pathParameters(spec.path)),
  });
  DEFINED.add(descriptor);
  return descriptor;
}
