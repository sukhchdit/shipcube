import { defineRoute as route, fixtureRoute as testRoute } from './route-support.js';

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;

// D-ARCH-111 (c): the route factories are recognised through an import alias.
export const aliased = route({ operationId: 'aliased', handler: async () => deps.queue.add('aliased', {}) });
export const aliasedFixture = testRoute({ transaction: 'tenant', handler: async () => deps.queue.add('fixture', {}) });
