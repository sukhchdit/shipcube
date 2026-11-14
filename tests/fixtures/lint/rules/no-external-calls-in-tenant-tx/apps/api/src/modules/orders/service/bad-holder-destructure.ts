interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// Code review R1-n8: a destructuring rename whose key is a `names` entry matches like the const alias.
export const enqueue = (ctx: unknown, deps: Deps): Promise<unknown> =>
  withTenantTx(ctx, async () => {
    const { queue: jobs } = deps;
    return jobs.add('renamed', {});
  });

// A nested pattern.
export const enqueueNested = (ctx: unknown, holder: { deps: Deps }): Promise<unknown> =>
  withTenantTx(ctx, async () => {
    const {
      deps: { queue: work },
    } = holder;
    return work.add('nested', {});
  });
