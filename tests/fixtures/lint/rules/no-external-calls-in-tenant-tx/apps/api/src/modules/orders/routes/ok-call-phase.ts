interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

interface PhaseContext {
  url: string;
  signal: AbortSignal;
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 (5) positive control: `call` runs between the load and the handler transactions, outside both, so
// external I/O and sleeps are fine there (only platform/outbound-http-via-client fires, on the raw fetch).
export const quote = defineRoute({
  operationId: 'quoteCall',
  transaction: 'tenant',
  load: async () => ({ id: 'order-1' }),
  call: async (ctx: PhaseContext, loaded: { id: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return fetch(`${ctx.url}/${loaded.id}`, { signal: ctx.signal });
  },
  handler: async () => ({ status: 200 }),
});

export const enqueue = defineRoute({
  operationId: 'enqueueCall',
  async call(ctx: PhaseContext) {
    return deps.queue.add('call', { url: ctx.url });
  },
  handler: async () => ({ status: 200 }),
});
