/**
 * The audit descriptor at run time (REQ-AUDIT-001/006/010, DR-A10/A13, ADR-0007 §Capture; US-086, AT-US-008-03 audit
 * hop; TASK-029). Pure: it compiles a route's `audit` descriptor once, at mount time, and builds the complete entry of a
 * request from the descriptor, the validated request context and the handler's result. No I/O (a T-83 root folder).
 *
 * Mount-time rules (the route fails to mount, naming method and path; AT-US-086-02):
 *  - an audited route names its entity (`^[a-z][a-z0-9_]*$`) and has an entity-ID resolver: `auditEntityId`, or one the
 *    descriptor implies (CREATE: the result body's `id`; a path parameter named `<entity>Id`; a list `VIEW`, which
 *    records the filter summary and the result count instead, DR-A13);
 *  - `NONE` only with a justification (defineRoute) and, checked by the route tests against the composed app, only for
 *    the REQ-AUDIT-006 closed list ({@link AUDIT_NONE_ROUTES}, AT-US-086-07);
 *  - `LOGIN`, `LOGOUT`, `MFA_ENROLLED` and `STATE_TRANSITION` entries carry what only their domain knows (the signed-in
 *    user, the from/to state), so the identity module and the state machine record them through the writer
 *    (allow-listed callers, ADR-0007 §Capture); until such a recorder exists the route is refused (O4).
 *
 * Entry rules: the actor is the request principal; `orgId` its active organisation (the stream; the writer refuses any
 * other, D-ARCH-122 STREAM_MISMATCH); the correlation id is the request's (AT-US-008-03); the IP is `req.ip` as the
 * trusted proxy chain computed it (D-ARCH-125: never parsed from X-Forwarded-For here); the route is the TEMPLATE.
 * Client-shaped values reach the entry only in the shape the writer accepts, else `null` (PR42-SEC-15): the entity id,
 * the parsed user agent, the template. Field-level diffs (`oldValue` / `newValue`) and the reason text are TASK-031 and
 * the REQ-AUDIT-025 owner; this middleware records neither yet.
 */
import {
  type AuditEntryAction,
  type AuditEntryInput,
  type AuditOutcome,
  type AuditSourceApp,
  type AuditValue,
  canonicalIp,
  isAuditEntityId,
  isAuditRouteTemplate,
  isAuditUaParsed,
  pii,
} from '@platform/audit';
import type { AuditAction } from '@platform/shared';

import type { RouteDescriptor, RouteRequestContext, RouteResult } from '../routing/define-route.js';
import { SlotNotImplementedError } from '../routing/slot.js';

/**
 * The REQ-AUDIT-006 closed list (D-043, ADR-0016 amendment 5(c)): the only routes that may declare audit action `NONE`,
 * as `METHOD path` with the path relative to its mount (health at the root, modules under /api/v1). Public
 * reference-data reads, health endpoints, static documents, the CSRF-token read, the CSP report and the two pure
 * calculators. Equal to the contract's NONE operations (tests/generated/audit-descriptors.test.ts pins both ways).
 */
export const AUDIT_NONE_ROUTES: ReadonlySet<string> = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /auth/csrf',
  'POST /security/csp-report',
  'GET /reference/countries',
  'GET /reference/countries/:countryCode',
  'GET /reference/countries/:countryCode/subdivisions',
  'GET /reference/currencies',
  'GET /reference/fx-rates',
  'GET /reference/fx-rates/convert',
  'GET /reference/incoterms',
  'GET /reference/export-reasons',
  'GET /reference/carriers',
  'GET /reference/hs-codes',
  'GET /reference/prohibited-items',
  'GET /reference/holidays',
  'GET /reference/volumetric',
  'GET /compliance/packs/:packCountry',
  'GET /compliance/legal/:packCountry/:legalDocument',
]);

/** `METHOD path` of a route, the key of {@link AUDIT_NONE_ROUTES}. */
export const routeKey = (route: Pick<RouteDescriptor, 'method' | 'path'>): string => `${route.method.toUpperCase()} ${route.path}`;

/** Why a route's `NONE` is refused (AT-US-086-07), or undefined when it is audited or on the closed list. */
export function auditNoneProblem(route: RouteDescriptor): string | undefined {
  if (route.audit.action !== 'NONE' || AUDIT_NONE_ROUTES.has(routeKey(route))) return undefined;
  return `${routeKey(route)} (${route.operationId}) declares audit action NONE, which REQ-AUDIT-006 allows only for its closed list`;
}

/** An audited route whose descriptor the capture middleware cannot honour (AT-US-086-02). */
export class AuditDescriptorError extends Error {
  constructor(route: Pick<RouteDescriptor, 'method' | 'path' | 'operationId'>, problem: string) {
    super(`audit descriptor of ${routeKey(route)} (${route.operationId}): ${problem}`);
    this.name = 'AuditDescriptorError';
  }
}

/** Actions whose entry only the domain module can complete; the capture refuses to mount them (see the header). */
const DOMAIN_RECORDED: ReadonlySet<AuditAction> = new Set(['LOGIN', 'LOGOUT', 'MFA_ENROLLED', 'STATE_TRANSITION']);
/** Actions recorded inside the handler transaction (the mutation and its entry commit together, REQ-AUDIT-004). */
const WRITE_ACTIONS: ReadonlySet<AuditAction> = new Set(['CREATE', 'UPDATE', 'DELETE', 'CONFIG_CHANGE']);
const ENTITY_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const MUTATING_METHODS: ReadonlySet<string> = new Set(['post', 'put', 'patch', 'delete']);

/**
 * How the entry of a route is written: `write` in the handler transaction; `view` (a detail VIEW / DOWNLOAD) and
 * `list` (one VIEW per list request with the filter summary and result count, DR-A13) in their own short transaction
 * after the result is fixed and before the response is released (ADR-0007 am. 10; REQ-AUDIT-005).
 */
export type CaptureMode = 'write' | 'view' | 'list';

export interface CompiledAudit {
  readonly route: RouteDescriptor;
  readonly action: Exclude<AuditAction, 'NONE'>;
  readonly entityName: string;
  readonly sensitive: boolean;
  readonly mode: CaptureMode;
  /** The entity id of the request (raw; {@link entryFor} keeps it only when well-formed). */
  readonly entityId: (request: RouteRequestContext, result: RouteResult | undefined) => unknown;
}

const camel = (snake: string): string => snake.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
const bodyField = (result: RouteResult | undefined, key: string): unknown => {
  const body: unknown = result?.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined;
};

/**
 * Compiles an audited route's descriptor (undefined for `NONE`). Throws {@link AuditDescriptorError} for an
 * incomplete descriptor and `SlotNotImplementedError` for a domain-recorded action.
 */
export function compileAudit(route: RouteDescriptor): CompiledAudit | undefined {
  const { action, entity, sensitivity } = route.audit;
  if (action === 'NONE') return undefined;
  if (DOMAIN_RECORDED.has(action)) {
    throw new SlotNotImplementedError(
      'audit',
      route.operationId,
      `audit action ${action}`,
      'the domain module that records it (TASK-029 D-TASK029-05)',
    );
  }
  if (entity === null || !ENTITY_NAME.test(entity)) throw new AuditDescriptorError(route, 'an audited route names its entity');
  const idParam = `${camel(entity)}Id`;
  const base = { route, action, entityName: entity, sensitive: sensitivity === 'SENSITIVE' } as const;
  const mode: CaptureMode = WRITE_ACTIONS.has(action) ? 'write' : 'view';
  if (route.auditEntityId !== undefined) return { ...base, mode, entityId: route.auditEntityId };
  if (route.pathParams.includes(idParam)) return { ...base, mode, entityId: (request) => request.input.params[idParam] };
  if (action === 'CREATE') return { ...base, mode, entityId: (_request, result) => bodyField(result, 'id') };
  if (action === 'VIEW' && route.method === 'get') return { ...base, mode: 'list', entityId: () => null };
  throw new AuditDescriptorError(route, `an audited route needs an entity-ID resolver (auditEntityId, or a :${idParam} path parameter)`);
}

/** The entry's source app: `X-Client-App` when it names a first-party client, else `api` (ADR-0007 §Capture). */
const sourceAppOf = (clientApp: string): AuditSourceApp => (clientApp === 'web' || clientApp === 'admin' ? clientApp : 'api');

/** Parses a raw user agent into `Family major / OS`; the capture keeps its output only in the writer's shape. */
export type UserAgentParser = (userAgent: string) => unknown;

/** A list view's filter summary (DR-A13): the validated query, every value tokenised (data-model §3.4 `details`). */
function filterSummary(query: Readonly<Record<string, unknown>>): AuditValue {
  const summary: Record<string, AuditValue> = {};
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (value === undefined) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    summary[key] = pii({ entityName: 'audit_entry', field: 'filter', classification: 'PERSONAL', value: text, subject: null });
  }
  return summary;
}

/** The result count of a list response (`{ data: [...] }`, api/README §8), or null for another shape. */
const resultCount = (result: RouteResult | undefined): number | null => {
  const data = bodyField(result, 'data');
  return Array.isArray(data) ? data.length : null;
};

export interface EntryContext {
  readonly compiled: Pick<CompiledAudit, 'route' | 'entityName' | 'mode' | 'entityId'>;
  readonly request: RouteRequestContext;
  readonly result: RouteResult | undefined;
  readonly action: AuditEntryAction;
  readonly outcome: AuditOutcome;
  /** Extra context (`status`, `code`, `required_permission`), merged into `details`. */
  readonly details?: Readonly<Record<string, AuditValue>>;
  readonly parseUserAgent?: UserAgentParser | undefined;
}

/** The complete entry of one request (personal values marked; client-shaped columns null unless valid). */
export function entryFor(context: EntryContext): AuditEntryInput {
  const { compiled, request, result, action, outcome } = context;
  const { principal, transport } = request;
  const entityId = compiled.entityId(request, result);
  const userAgent = transport.userAgent === '' ? null : transport.userAgent;
  const parsed = userAgent === null || context.parseUserAgent === undefined ? null : context.parseUserAgent(userAgent);
  const list: Record<string, AuditValue> =
    compiled.mode === 'list' && result !== undefined
      ? { filter: filterSummary(request.input.query), result_count: resultCount(result) }
      : {};
  const details = { ...list, ...context.details };
  return {
    action,
    outcome,
    entityName: compiled.entityName,
    entityId: isAuditEntityId(entityId) ? entityId : null,
    orgId: principal.orgId === '' ? null : principal.orgId,
    actor: principal.authenticated ? { type: 'USER', userId: principal.actorId } : { type: 'ANONYMOUS' },
    origin: {
      sourceApp: sourceAppOf(transport.clientApp),
      correlationId: request.correlationId,
      ip: canonicalIp(transport.ip),
      userAgent,
      uaParsed: isAuditUaParsed(parsed) ? parsed : null,
      httpMethod: compiled.route.method.toUpperCase(),
      route: isAuditRouteTemplate(transport.routeTemplate) ? transport.routeTemplate : null,
    },
    ...(Object.keys(details).length === 0 ? {} : { details }),
  };
}

/**
 * REQ-AUDIT-010: a FAILED entry is written for an authenticated MUTATING request that passed authorisation and ended in
 * 409, 422 or 5xx; 400 (validation) is logged only.
 */
export function failedOutcomeApplies(route: RouteDescriptor, request: RouteRequestContext, status: number): boolean {
  return request.principal.authenticated && MUTATING_METHODS.has(route.method) && (status === 409 || status === 422 || status >= 500);
}
