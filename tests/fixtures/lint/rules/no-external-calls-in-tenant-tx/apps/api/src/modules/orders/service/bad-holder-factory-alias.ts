interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// Code review R2-n3: the DI factory shape, a holder alias declared in the enclosing factory function.
export function createService(d: Deps): { run(ctx: unknown): Promise<unknown> } {
  const q = d.queue;
  return { run: (ctx) => withTenantTx(ctx, async () => q.add('factory-alias', {})) };
}
