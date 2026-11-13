declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const backoff = (ctx: unknown): Promise<void> =>
  withTenantTx(ctx, async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
