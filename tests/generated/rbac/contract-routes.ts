/**
 * The RBAC matrix inputs read from openapi.yaml (US-071; TASK-027): every operation as a `MatrixRoute` (the committed
 * matrix covers the whole contract) and as a contract-shaped `defineRoute` fixture (the `contract` layer of the
 * rbac-matrix suite mounts all of them, so every permission, credential set, dual-mode route, signature route and MFA
 * exemption of the contract runs through the real authenticate, MFA-gate and authorise slots before any module route
 * exists). The metadata comes from `contractBoundRoutes` (route-metadata.ts), the reading the build-time route test
 * already compares with every mounted descriptor, plus `x-mfa-gate-exempt`.
 */
import { isRouteMarker, type MatrixRoute } from '@platform/authz';
import Joi from 'joi';

import { API_PREFIX } from '../../../apps/api/src/app.js';
import { defineRoute, type RouteDescriptor, type RouteSpec } from '../../../apps/api/src/platform/routing/define-route.js';
import { type ContractOperation, listOperations, type OpenApiDocument } from '../../../tools/openapi/contract.js';
import { contractBoundRoutes } from '../route-metadata.js';

/** One contract operation: its matrix route (OpenAPI path, full) and where it is mounted. */
export interface ContractRoute {
  readonly matrix: MatrixRoute;
  readonly operation: ContractOperation;
  /** Mounted under `/api/v1` (a module route) or at the root (`/health/*`). */
  readonly mount: 'api' | 'root';
}

/** Every operation of the contract, in contract order. */
export function contractRoutes(doc: OpenApiDocument): ContractRoute[] {
  const bound = new Map(contractBoundRoutes(doc).map((entry) => [entry.operationId, entry.route]));
  return listOperations(doc).map((operation) => {
    const route = bound.get(operation.operationId);
    if (route === undefined) throw new Error(`contractBoundRoutes lost ${operation.operationId}`);
    return {
      operation,
      mount: operation.fullPath.startsWith(`${API_PREFIX}/`) ? 'api' : 'root',
      matrix: {
        operationId: operation.operationId,
        method: route.method,
        path: route.path,
        permission: route.permission,
        tenancy: route.tenancy,
        auth: route.auth,
        permissionAuthenticated: route.permissionAuthenticated,
        mfaGateExempt: operation.operation['x-mfa-gate-exempt'] === true,
      },
    };
  });
}

const handler = (): { readonly status: number } => ({ status: 204 });

/**
 * A `defineRoute` descriptor declaring what openapi.yaml says about the operation: permission (and justification),
 * audit, tenancy, credential set, `x-permission-authenticated`, CSRF, MFA exemption, rate-limit class, idempotency and a
 * closed params schema. The matrix app ends the pipeline right after authorise, so the handler never runs.
 */
export function contractDescriptor(route: ContractRoute): RouteDescriptor {
  const { operation, matrix } = route;
  const x = (name: string): unknown => operation.operation[name];
  const params = Object.fromEntries(
    ((operation.operation['parameters'] as readonly Readonly<Record<string, unknown>>[] | undefined) ?? [])
      .filter((parameter) => parameter['in'] === 'path')
      .map((parameter) => [String(parameter['name']), Joi.string().required()]),
  );
  const audit = x('x-audit') as Readonly<Record<string, unknown>>;
  const spec = {
    operationId: matrix.operationId,
    method: operation.method.toLowerCase(),
    path: operation.path.replaceAll(/\{([^}]+)\}/g, ':$1'),
    permission: matrix.permission,
    // A justification only on a marker, and NONE audits without an entity (defineRoute's rules): two contract entries
    // (refreshShipmentTracking; getCsrfToken, reportCspViolation) carry one more field than a route may declare. Neither
    // field takes part in an authorisation decision; the route-metadata test judges them when those routes are mounted.
    ...(isRouteMarker(matrix.permission) ? { permissionJustification: x('x-permission-justification') } : {}),
    audit: audit['action'] === 'NONE' ? { ...audit, entity: null } : audit,
    schema: Object.keys(params).length === 0 ? {} : { params: Joi.object(params) },
    rateLimit: x('x-rate-limit-class'),
    idempotency: x('x-idempotency'),
    tenancy: matrix.tenancy,
    auth: matrix.auth,
    ...(matrix.permissionAuthenticated === undefined ? {} : { permissionAuthenticated: matrix.permissionAuthenticated }),
    ...(x('x-csrf') === true ? { csrf: true } : {}),
    ...(matrix.mfaGateExempt === true ? { mfaGateExempt: true } : {}),
    handler,
  } as unknown as RouteSpec;
  return defineRoute(spec);
}
