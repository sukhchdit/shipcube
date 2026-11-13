declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const refresh = (ctx: unknown, url: string): Promise<Response> => withTenantTx(ctx, async () => fetch(url));
