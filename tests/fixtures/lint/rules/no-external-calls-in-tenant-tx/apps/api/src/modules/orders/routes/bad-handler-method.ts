interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 R2: method shorthand handlers, plain and async.
export const plain = defineRoute({
  operationId: 'plainHandler',
  handler() {
    return deps.queue.add('plain', {});
  },
});

export const asynchronous = defineRoute({
  operationId: 'asyncHandler',
  async handler() {
    return deps.queue.add('async', {});
  },
});
