interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const enqueue = (deps: Deps, ctx: unknown, data: unknown): Promise<unknown> =>
  withTenantTx(ctx, async () => deps.queue.add('label', data));
