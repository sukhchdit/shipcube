/**
 * The `{orgId}` confused-deputy variant of the RBAC matrix (SEC-TC-01; threat model T-32, AC-06; ADR-0005 am. 3; api
 * README §3 "Tenancy in paths"; TASK-027). Pure. Tenant scope comes from the access token's active organisation, never
 * from the path: on every `tenant` route with an `orgId` path parameter, a caller the matrix ALLOWS in its active
 * organisation A who names organisation B in the path gets 404 `NOT_FOUND` (the answer to a missing resource) and no
 * data of B, before any query. The generator picks that caller from the matrix itself, so the case isolates the path
 * rule from the permission gate: a customer role first, then a partner role, then a staff role with a verified factor.
 */
import { type MatrixCaller, type MatrixRoute, type RouteMatrix } from './matrix.js';

/** The path parameter that names an organisation (api/README §3). */
export const ORG_PATH_PARAMETER = 'orgId';

const PATH_PARAMETER = /(?:^|\/)(?::([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})(?=\/|$)/g;

/** The parameter names of an Express (`:id`) or OpenAPI (`{id}`) path, in order. */
export const pathParameterNames = (path: string): string[] =>
  [...path.matchAll(PATH_PARAMETER)].map((match) => String(match[1] ?? match[2]));

/** The routes SEC-TC-01 covers: `tenant` tenancy with an `orgId` path parameter (operator cross-tenant routes name it by design). */
export const orgScopedRoutes = <R extends MatrixRoute>(routes: readonly R[]): R[] =>
  routes.filter((route) => route.tenancy === 'tenant' && pathParameterNames(route.path).includes(ORG_PATH_PARAMETER));

export interface OrgMismatchCase {
  readonly route: MatrixRoute;
  /** A role caller the matrix allows on the route (so a refusal can only come from the path rule). */
  readonly caller: Extract<MatrixCaller, { kind: 'role' }>;
}

const SCOPE_PREFERENCE = ['CUSTOMER', 'PARTNER', 'OPERATOR'] as const;

/**
 * One case per org-scoped route of `matrix`; a route no seeded role is allowed on cannot be probed and is a finding
 * (fail closed: the suite never skips it).
 */
export function orgMismatchCases(matrix: RouteMatrix): { readonly cases: OrgMismatchCase[]; readonly findings: string[] } {
  const roleCallers = new Map(matrix.callers.flatMap((caller) => (caller.kind === 'role' ? [[caller.id, caller] as const] : [])));
  const cases: OrgMismatchCase[] = [];
  const findings: string[] = [];
  for (const { route, cells } of matrix.rows.filter((row) => orgScopedRoutes([row.route]).length === 1)) {
    const allowed = cells
      .flatMap((cell) => {
        const caller = roleCallers.get(cell.caller);
        return cell.outcome === 'allow' && caller !== undefined ? [caller] : [];
      })
      .sort((a, b) => SCOPE_PREFERENCE.indexOf(a.scope) - SCOPE_PREFERENCE.indexOf(b.scope));
    const [caller] = allowed;
    if (caller === undefined)
      findings.push(
        `[SEC-TC-01] ${route.method.toUpperCase()} ${route.path} (${route.operationId}): no seeded role is allowed, so the org-scope case cannot be built`,
      );
    else cases.push({ route, caller });
  }
  return { cases, findings };
}
