/**
 * Test helper (TASK-020): declares a framework-test fixture route with `defineRoute`, so tests of createApp exercise
 * the same pipeline as production routes. The defaults describe an anonymous, public, unaudited GET without a
 * database transaction; a test overrides only what it is about. Never imported by production code.
 */
import { defineRoute, type RouteDescriptor, type RouteHandler, type RouteSpec } from '../define-route.js';

export type FixtureRouteSpec = Partial<Omit<RouteSpec, 'permission' | 'permissionJustification'>> & {
  readonly operationId: string;
  readonly path: string;
  readonly handler: RouteHandler;
};

export function fixtureRoute(spec: FixtureRouteSpec): RouteDescriptor {
  return defineRoute({
    method: 'get',
    permission: 'public',
    permissionJustification: 'Framework test fixture.',
    audit: { action: 'NONE', entity: null, sensitivity: 'NONE', reasonRequired: false, justification: 'Framework test fixture.' },
    schema: {},
    rateLimit: 'none',
    idempotency: 'not-applicable',
    tenancy: 'public',
    auth: 'anonymous',
    transaction: 'none',
    ...spec,
  });
}
