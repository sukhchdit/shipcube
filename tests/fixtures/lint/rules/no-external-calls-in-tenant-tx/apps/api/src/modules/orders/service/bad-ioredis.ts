import Redis from 'ioredis';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// A same-file variable initialised from the import is followed.
const cache = new Redis();

export const read = (ctx: unknown, key: string): Promise<string | null> => withTenantTx(ctx, async () => cache.get(key));
