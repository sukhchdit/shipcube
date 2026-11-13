interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function fixtureRoute(spec: object): unknown;

// D-ARCH-106 R2: fixtureRoute defaults to transaction none; with transaction: 'tenant' its handler is a root.
export const tenant = fixtureRoute({ transaction: 'tenant', handler: async () => deps.queue.add('fixture', {}) });
