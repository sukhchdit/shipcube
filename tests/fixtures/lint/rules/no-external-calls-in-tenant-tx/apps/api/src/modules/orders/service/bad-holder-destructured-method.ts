interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// Code review R2-n3: a method destructured from a holder chain (flat and nested) is called inside the transaction.
export const enqueue = (ctx: unknown, deps: Deps): Promise<unknown> =>
  withTenantTx(ctx, async () => {
    const { add } = deps.queue;
    const {
      queue: { add: later },
    } = deps;
    await add('flat', {});
    return later('nested', {});
  });
