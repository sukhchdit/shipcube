declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// D-ARCH-111 (g): a literal import() of an external client module inside a root is external I/O (a string literal and
// a no-substitution template literal).
export const connect = (ctx: unknown): Promise<unknown[]> =>
  withTenantTx(ctx, async () => [await import('ioredis'), await import(`stripe`)]);
