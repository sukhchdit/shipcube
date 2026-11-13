/**
 * Route-permission checks (REQ-RBAC-005, REQ-RBAC-014, AT-US-065-04, ADR-0008 am. 3 item 3): every route declares a
 * catalogued permission or one of the route markers, and the permission is bound to a route of the right tenancy and
 * authentication (PR8-SEC-05 (a)-(d), D-ARCH-069). The route-metadata test (TASK-020) feeds the mounted routes; every
 * message names the offending `METHOD path` so CI output points at the route. Pure functions over plain data.
 */
import {
  isPermission,
  isRouteMarker,
  OPERATOR_ONLY_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  type Permission,
  type PermissionDefinition,
} from './permissions/index.js';

/** `x-tenancy` of the contract (api/README §10): which rows a route may reach and which context it runs in. */
export const ROUTE_TENANCIES = ['public', 'guest', 'tenant', 'user', 'operator-cross-tenant'] as const;
export type RouteTenancy = (typeof ROUTE_TENANCIES)[number];

/**
 * How a route authenticates its caller: none, a session (bearer access token or refresh cookie), the guest quote token
 * (`X-Quote-Token`), or a provider signature over the raw body (webhooks; ADR-0008 amendment).
 */
export const ROUTE_AUTHS = ['anonymous', 'session', 'quote-token', 'signature'] as const;
export type RouteAuth = (typeof ROUTE_AUTHS)[number];

export interface DeclaredRoute {
  readonly method: string;
  readonly path: string;
  readonly permission: string;
}

/** A route with the bindings PR8-SEC-05 checks. */
export interface BoundRoute extends DeclaredRoute {
  readonly tenancy: RouteTenancy;
  readonly auth: RouteAuth;
}

export class UnknownRoutePermissionError extends Error {
  constructor(readonly offenders: readonly DeclaredRoute[]) {
    super(
      `routes declare permissions absent from the catalogue: ${offenders
        .map((route) => `${route.method.toUpperCase()} ${route.path} -> "${route.permission}"`)
        .join('; ')}`,
    );
    this.name = 'UnknownRoutePermissionError';
  }
}

/** Routes whose permission is neither catalogued nor a route marker. */
export function findUnknownRoutePermissions(routes: readonly DeclaredRoute[]): DeclaredRoute[] {
  return routes.filter((route) => !isPermission(route.permission) && !isRouteMarker(route.permission));
}

export function assertRoutePermissions(routes: readonly DeclaredRoute[]): void {
  const offenders = findUnknownRoutePermissions(routes);
  if (offenders.length > 0) throw new UnknownRoutePermissionError(offenders);
}

/** The PR8-SEC-05 rule a binding violation breaks. */
export type RouteBindingRule = 'SELF_SERVICE_TENANCY' | 'OPERATOR_CROSS_TENANT' | 'SIGNATURE_AUTH' | 'MOCK_WEBHOOK_IN_PRODUCTION';

export interface RouteBindingViolation {
  readonly rule: RouteBindingRule;
  readonly route: string;
  readonly message: string;
}

/** The permission that must never be mounted when `APP_ENV=production` (T-67 class: a known mock signing secret). */
export const MOCK_GATEWAY_PERMISSION: Permission = 'webhook:mock_gateway:receive';

const DEFINITIONS: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition]),
);
const OPERATOR_ONLY: ReadonlySet<string> = new Set(OPERATOR_ONLY_PERMISSIONS);

const isAnyOrg = (permission: string): boolean => permission.split(':').includes('any_org');

function bindingProblems(route: BoundRoute, production: boolean): [RouteBindingRule, string][] {
  const { permission, tenancy, auth } = route;
  const definition = DEFINITIONS.get(permission);
  const problems: [RouteBindingRule, string][] = [];
  // (a) D-058: a self-service permission is safe only on `user`-tenancy routes over the caller's own rows.
  if (definition?.selfService === true && tenancy !== 'user') {
    problems.push(['SELF_SERVICE_TENANCY', `self-service permission "${permission}" guards a "${tenancy}" route; only "user" is allowed`]);
  }
  // (b) DR-A07 / ADR-0005: operator cross-tenant reach pairs with an operator-only permission, and :any_org with it.
  if (tenancy === 'operator-cross-tenant' && !OPERATOR_ONLY.has(permission)) {
    problems.push(['OPERATOR_CROSS_TENANT', `"operator-cross-tenant" route declares "${permission}", which is not operator-only`]);
  }
  if (isAnyOrg(permission) && tenancy !== 'operator-cross-tenant') {
    problems.push([
      'OPERATOR_CROSS_TENANT',
      `":any_org" permission "${permission}" on a "${tenancy}" route; it requires "operator-cross-tenant"`,
    ]);
  }
  // (c) A signature-only permission is satisfied by a signature-authenticated route only (never anonymous, a session or
  // a guest token). A signature route declares a signature-only permission or the `public` marker (the contract's
  // carrier push, `receiveCarrierPush`, D-TASK020-03), never a session permission or `authenticated`.
  if (definition?.signatureOnly === true && auth !== 'signature') {
    problems.push(['SIGNATURE_AUTH', `signature-only permission "${permission}" on a "${auth}" route; only "signature" satisfies it`]);
  }
  if (auth === 'signature' && definition?.signatureOnly !== true && permission !== 'public') {
    problems.push(['SIGNATURE_AUTH', `"signature" route declares "${permission}", which is neither signature-only nor "public"`]);
  }
  // (d) The mock gateway webhook is a non-production seam.
  if (production && permission === MOCK_GATEWAY_PERMISSION) {
    problems.push(['MOCK_WEBHOOK_IN_PRODUCTION', `"${permission}" must not be mounted when APP_ENV is production`]);
  }
  return problems;
}

/**
 * Every PR8-SEC-05 binding violation over the mounted routes: (a) a self-service permission guards only `user`
 * routes; (b) `operator-cross-tenant` requires an operator-only permission and an `:any_org` permission requires that
 * tenancy; (c) a signature-only permission is satisfied only by `auth: signature`, and a signature route declares a
 * signature-only permission or `public`; (d) no route carries `webhook:mock_gateway:receive` in production.
 */
export function findRouteBindingViolations(routes: readonly BoundRoute[], env: { readonly production: boolean }): RouteBindingViolation[] {
  return routes.flatMap((route) => {
    const name = `${route.method.toUpperCase()} ${route.path}`;
    return bindingProblems(route, env.production).map(([rule, message]) => ({ rule, route: name, message: `${name}: ${message}` }));
  });
}
