declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// Test files are out of scope: a test may hold the transaction open on purpose (lock and timeout probes).
export const holdOpen = (ctx: unknown): Promise<void> =>
  withTenantTx(ctx, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
