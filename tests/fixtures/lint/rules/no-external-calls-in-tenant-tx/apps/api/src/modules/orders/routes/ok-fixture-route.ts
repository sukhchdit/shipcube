interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function fixtureRoute(spec: object): unknown;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 positive controls: fixtureRoute defaults to transaction none; `call` and `afterCommit` are never roots.
export const fixture = fixtureRoute({ handler: async () => deps.queue.add('fixture', {}) });

export const phases = defineRoute({
  operationId: 'phases',
  call: async () => deps.queue.add('call', {}),
  afterCommit: async () => deps.queue.add('afterCommit', {}),
  handler: async () => ({ status: 200 }),
});
