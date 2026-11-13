interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare const base: object;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 positive control: transaction: 'none' (a string literal, last, no spread after it) is the only hatch.
export const health = defineRoute({
  operationId: 'getHealth',
  transaction: 'none',
  handler: async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return deps.queue.add('ping', {});
  },
});

// A spread BEFORE the literal 'none' cannot override it.
export const spreadThenNone = defineRoute({ ...base, transaction: 'none', handler: async () => deps.queue.add('ping', {}) });
