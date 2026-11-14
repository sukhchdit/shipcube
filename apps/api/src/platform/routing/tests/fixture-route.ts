/**
 * Test helper (TASK-020): declares a framework-test fixture route with `defineRoute`, so tests of createApp exercise
 * the same pipeline as production routes. The defaults describe an anonymous, public, unaudited GET without a
 * database transaction; a test overrides only what it is about. Never imported by production code.
 */
import { defineRoute, type RouteDescriptor, type RouteHandler, type RouteSpec } from '../define-route.js';

export type FixtureRouteSpec<L = undefined, C = undefined> = Partial<Omit<RouteSpec<L, C>, 'permission' | 'permissionJustification'>> & {
  readonly operationId: string;
  readonly path: string;
  readonly handler: RouteHandler<L, C>;
};

/** `L` and `C` are inferred from `load` and `call`, as in `defineRoute` (part 020-C). */
export function fixtureRoute<L = undefined, C = undefined>(spec: FixtureRouteSpec<L, C>): RouteDescriptor {
  return defineRoute<L, C>({
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
