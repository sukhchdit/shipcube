/**
 * Route-permission checks (REQ-RBAC-005, REQ-RBAC-014, AT-US-065-04, ADR-0008 am. 3 item 3 and am. 4): every route
 * declares a catalogued permission or one of the route markers, and the permission is bound to a route of the right
 * tenancy and authentication (PR8-SEC-05 (a)-(d), D-ARCH-069, D-ARCH-107). The route-metadata test (TASK-020) feeds the
 * mounted routes; every message names the offending `METHOD path` so CI output points at the route. Pure functions over
 * plain data.
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
 * The credential kinds a route accepts (D-ARCH-107 (1), ADR-0008 am. 4), in canonical order: none (`anonymous`), the
 * bearer access token (`session`), the refresh cookie of the session endpoints (`refresh-cookie`: `refreshSession`,
 * `logoutSession` and `getCsrfToken` are called with an expired or absent access token), the guest quote token
 * (`X-Quote-Token`, `quote-token`) and a provider signature over the raw body (`signature`, webhooks).
 */
export const ROUTE_AUTHS = ['anonymous', 'session', 'refresh-cookie', 'quote-token', 'signature'] as const;
export type RouteAuth = (typeof ROUTE_AUTHS)[number];
/** A route's authentication: the credential kinds it accepts (the contract's `security` alternatives, one to one). */
export type RouteAuthSet = readonly RouteAuth[];

const freezeSet = (...kinds: RouteAuth[]): RouteAuthSet => Object.freeze(kinds);

/**
 * The closed list of accepted sets, each in canonical order (D-ARCH-107 (1)): `[anonymous, session]` is `createQuote`
 * (optional session), `[session, quote-token]` is `getQuote` and `streamQuoteResults` (session or guest token). A new
 * combination needs an ADR amendment, never a route of its own.
 */
export const ROUTE_AUTH_SETS: readonly RouteAuthSet[] = Object.freeze([
  freezeSet('anonymous'),
  freezeSet('session'),
  freezeSet('refresh-cookie'),
  freezeSet('signature'),
  freezeSet('anonymous', 'session'),
  freezeSet('session', 'quote-token'),
]);

export const isRouteAuth = (value: unknown): value is RouteAuth => (ROUTE_AUTHS as readonly unknown[]).includes(value);

/** Kinds in canonical order (unknown values last, alphabetically), joined: the order-insensitive identity of a set. */
const canonicalKey = (kinds: readonly unknown[]): string => {
  const rank = (kind: string): number => (isRouteAuth(kind) ? ROUTE_AUTHS.indexOf(kind) : ROUTE_AUTHS.length);
  return kinds
    .map(String)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .join(',');
};
const SETS_BY_KEY: ReadonlyMap<string, RouteAuthSet> = new Map(ROUTE_AUTH_SETS.map((set) => [canonicalKey(set), set]));

/**
 * The accepted set equal to `kinds` (order-insensitive), frozen and in canonical order; `undefined` for an unlisted
 * combination, an unknown kind or a repeated kind.
 */
export function findRouteAuthSet(kinds: readonly unknown[]): RouteAuthSet | undefined {
  return new Set(kinds).size === kinds.length ? SETS_BY_KEY.get(canonicalKey(kinds)) : undefined;
}

export const formatRouteAuth = (kinds: readonly unknown[]): string => `[${kinds.map(String).join(', ')}]`;

const isSet = (kinds: readonly unknown[], ...expected: RouteAuth[]): boolean => canonicalKey(kinds) === canonicalKey(expected);

/** A dual-mode route (D-ARCH-107 (2)): permission `public` with `[anonymous, session]` or `[session, quote-token]`. */
export const isDualModeRoute = (permission: string, auth: readonly unknown[]): boolean =>
  permission === 'public' && (isSet(auth, 'anonymous', 'session') || isSet(auth, 'session', 'quote-token'));

const DEFINITIONS: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/**
 * D-ARCH-107 (2): `permissionAuthenticated` (the contract's `x-permission-authenticated`) is required exactly on a
 * dual-mode route, and is a catalogued permission that is neither `selfService` nor `signatureOnly`. Shared by
 * `defineRoute` (refusal at module load) and the `DUAL_MODE` binding rule.
 */
export function permissionAuthenticatedProblems(permission: string, auth: readonly unknown[], permissionAuthenticated: unknown): string[] {
  const dual = isDualModeRoute(permission, auth);
  if (permissionAuthenticated === undefined) {
    return dual ? [`dual-mode route ("public", ${formatRouteAuth(auth)}) needs permissionAuthenticated`] : [];
  }
  if (!dual)
    return [`permissionAuthenticated is only allowed on a dual-mode route ("public" with [anonymous, session] or [session, quote-token])`];
  const definition = typeof permissionAuthenticated === 'string' ? DEFINITIONS.get(permissionAuthenticated) : undefined;
  if (definition === undefined)
    return [
      `permissionAuthenticated ${typeof permissionAuthenticated === 'string' ? `"${permissionAuthenticated}"` : typeof permissionAuthenticated} is not in the catalogue`,
    ];
  if (definition.selfService === true || definition.signatureOnly === true) {
    return [`permissionAuthenticated "${definition.key}" must be neither self-service nor signature-only`];
  }
  return [];
}

export interface DeclaredRoute {
  readonly method: string;
  readonly path: string;
  readonly permission: string;
}

/** A route with the bindings PR8-SEC-05 and D-ARCH-107 check. */
export interface BoundRoute extends DeclaredRoute {
  readonly tenancy: RouteTenancy;
  readonly auth: readonly RouteAuth[];
  /** `x-permission-authenticated`: the permission a `session` caller of a dual-mode route must hold. */
  readonly permissionAuthenticated?: string | undefined;
  /** `x-csrf`: the route checks the double-submit CSRF token. */
  readonly csrf?: boolean | undefined;
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

/** The PR8-SEC-05 / D-ARCH-107 rule a binding violation breaks. */
export type RouteBindingRule =
  | 'SELF_SERVICE_TENANCY'
  | 'OPERATOR_CROSS_TENANT'
  | 'SIGNATURE_AUTH'
  | 'MOCK_WEBHOOK_IN_PRODUCTION'
  | 'AUTH_SET'
  | 'PERMISSION_AUTH'
  | 'DUAL_MODE'
  | 'CSRF_COOKIE';

export interface RouteBindingViolation {
  readonly rule: RouteBindingRule;
  readonly route: string;
  readonly message: string;
}

/** The permission that must never be mounted when `APP_ENV=production` (T-67 class: a known mock signing secret). */
export const MOCK_GATEWAY_PERMISSION: Permission = 'webhook:mock_gateway:receive';

const OPERATOR_ONLY: ReadonlySet<string> = new Set(OPERATOR_ONLY_PERMISSIONS);

const isAnyOrg = (permission: string): boolean => permission.split(':').includes('any_org');

type Problem = [RouteBindingRule, string];

function tenancyProblems({ permission, tenancy }: BoundRoute, definition: PermissionDefinition | undefined): Problem[] {
  const problems: Problem[] = [];
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
  return problems;
}

/**
 * (c) `SIGNATURE_AUTH`: a signature-only permission is satisfied by `[signature]` only (never anonymous, a session or
 * a guest token). A route accepting a signature declares a signature-only permission or the `public` marker (the
 * contract's carrier push, `receiveCarrierPush`, D-TASK020-03), never a session permission or `authenticated`.
 */
function signatureProblems({ permission, auth }: BoundRoute, definition: PermissionDefinition | undefined): Problem[] {
  const problems: Problem[] = [];
  const signatureOnly = definition?.signatureOnly === true;
  if (signatureOnly && !isSet(auth, 'signature')) {
    problems.push([
      'SIGNATURE_AUTH',
      `signature-only permission "${permission}" on a ${formatRouteAuth(auth)} route; only [signature] satisfies it`,
    ]);
  }
  if (auth.includes('signature') && !signatureOnly && permission !== 'public') {
    problems.push([
      'SIGNATURE_AUTH',
      `${formatRouteAuth(auth)} route declares "${permission}", which is neither signature-only nor "public"`,
    ]);
  }
  return problems;
}

/** The fields of a route's authentication declaration (D-ARCH-107); `auth` may hold unchecked values. */
export type RouteAuthDeclaration = Pick<BoundRoute, 'method' | 'permission' | 'permissionAuthenticated' | 'csrf'> & {
  readonly auth: readonly unknown[];
};

/**
 * D-ARCH-107 (3), the authentication-declaration rules, as `[rule, message]` pairs: `AUTH_SET` (an accepted set),
 * `PERMISSION_AUTH` (a catalogued non-signature permission or `authenticated` is held by a user, so it needs exactly
 * `[session]`; this refuses `auth: 'anonymous'` with such a permission, PR #32 m7; signature sets are `SIGNATURE_AUTH`'s),
 * `DUAL_MODE` (`permissionAuthenticatedProblems`) and `CSRF_COOKIE` (ADR-0006: an unsafe request authenticated by the
 * ambient refresh cookie checks the double-submit token). `defineRoute` refuses these at module load.
 */
export function routeAuthProblems(route: RouteAuthDeclaration): [RouteBindingRule, string][] {
  const { method, permission, auth } = route;
  const shown = formatRouteAuth(auth);
  const definition = DEFINITIONS.get(permission);
  const problems: Problem[] = [];
  if (findRouteAuthSet(auth) === undefined) {
    problems.push(['AUTH_SET', `auth ${shown} is not an accepted set (${ROUTE_AUTH_SETS.map(formatRouteAuth).join(', ')})`]);
  }
  const userPermission = permission === 'authenticated' || (definition !== undefined && definition.signatureOnly !== true);
  if (userPermission && !auth.includes('signature') && !isSet(auth, 'session')) {
    problems.push(['PERMISSION_AUTH', `"${permission}" needs auth [session], not ${shown}`]);
  }
  for (const message of permissionAuthenticatedProblems(permission, auth, route.permissionAuthenticated))
    problems.push(['DUAL_MODE', message]);
  if (auth.includes('refresh-cookie') && method.toLowerCase() !== 'get' && route.csrf !== true) {
    problems.push(['CSRF_COOKIE', `a ${method.toUpperCase()} route accepting the refresh cookie needs csrf: true`]);
  }
  return problems;
}

function bindingProblems(route: BoundRoute, production: boolean): Problem[] {
  const definition = DEFINITIONS.get(route.permission);
  const problems = [...tenancyProblems(route, definition), ...signatureProblems(route, definition), ...routeAuthProblems(route)];
  // (d) The mock gateway webhook is a non-production seam.
  if (production && route.permission === MOCK_GATEWAY_PERMISSION) {
    problems.push(['MOCK_WEBHOOK_IN_PRODUCTION', `"${route.permission}" must not be mounted when APP_ENV is production`]);
  }
  return problems;
}

/**
 * Every binding violation over the mounted routes. PR8-SEC-05: (a) a self-service permission guards only `user`
 * routes; (b) `operator-cross-tenant` requires an operator-only permission and an `:any_org` permission requires that
 * tenancy; (c) `SIGNATURE_AUTH`: a signature-only permission is satisfied only by `[signature]`, and a signature route
 * declares a signature-only permission or `public`; (d) no route carries `webhook:mock_gateway:receive` in production.
 * D-ARCH-107 (3): `AUTH_SET` (the set is one of `ROUTE_AUTH_SETS`), `PERMISSION_AUTH` (a catalogued or `authenticated`
 * permission needs `[session]`), `DUAL_MODE` (`permissionAuthenticated` exactly on dual-mode routes, catalogued, neither
 * self-service nor signature-only) and `CSRF_COOKIE` (a non-GET `refresh-cookie` route has `csrf: true`).
 */
export function findRouteBindingViolations(routes: readonly BoundRoute[], env: { readonly production: boolean }): RouteBindingViolation[] {
  return routes.flatMap((route) => {
    const name = `${route.method.toUpperCase()} ${route.path}`;
    return bindingProblems(route, env.production).map(([rule, message]) => ({ rule, route: name, message: `${name}: ${message}` }));
  });
}
