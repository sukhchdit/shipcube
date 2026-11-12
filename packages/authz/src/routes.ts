/**
 * Route-permission check (REQ-RBAC-005, REQ-RBAC-014, AT-US-065-04): every route declares a catalogued permission or
 * one of the route markers. The router-enumeration test (TASK-020) feeds the mounted routes; the error names each
 * offending `METHOD path` so CI output points at the route.
 */
import { isPermission, isRouteMarker } from './permissions/index.js';

export interface DeclaredRoute {
  readonly method: string;
  readonly path: string;
  readonly permission: string;
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
