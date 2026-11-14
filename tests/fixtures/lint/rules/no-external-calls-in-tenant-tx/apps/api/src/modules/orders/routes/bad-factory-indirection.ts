import { fixtureRoute as testRoute } from './route-support.js';

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;
declare function prepare(): void;

// PR44-SEC-04 F01-F03: a route factory used other than as a direct callee hides the spec from the rule, so the
// reference itself is reported (each handler below would otherwise pass unseen).
// F01: Function.prototype.call.
export const viaCall = defineRoute.call(deps, { operationId: 'viaCall', handler: async () => deps.queue.add('call', {}) });

// F02: a const alias.
const dr = defineRoute;
export const viaAlias = dr({ operationId: 'viaAlias', handler: async () => deps.queue.add('alias', {}) });

// F03: a sequence expression callee.
export const viaSequence = (prepare(), defineRoute)({ operationId: 'viaSequence', handler: async () => deps.queue.add('seq', {}) });

// An import alias passed on as a value.
export const factories = [testRoute];
