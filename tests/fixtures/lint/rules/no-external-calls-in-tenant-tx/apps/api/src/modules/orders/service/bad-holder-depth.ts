interface Queue {
  add(name: string, data: unknown): Promise<unknown>;
}

interface Services {
  queue: Queue;
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// D-ARCH-111 (d): a receiver chain ending in a `names` entry matches at any depth, and through one same-function
// const alias of such a chain.
export const enqueueNested = (ctx: { deps: Services }): Promise<unknown> => withTenantTx(ctx, async () => ctx.deps.queue.add('nested', {}));

export const enqueueServices = (services: Services, ctx: unknown): Promise<unknown> =>
  withTenantTx(ctx, async () => services.queue.add('services', {}));

export class OrdersJobs {
  constructor(private readonly x: Services) {}

  enqueue(ctx: unknown): Promise<unknown> {
    return withTenantTx(ctx, async () => this.x.queue.add('this', {}));
  }
}

export const enqueueAlias = (deps: Services, ctx: unknown): Promise<unknown> =>
  withTenantTx(ctx, async () => {
    const q = deps.queue;
    return q.add('alias', {});
  });
