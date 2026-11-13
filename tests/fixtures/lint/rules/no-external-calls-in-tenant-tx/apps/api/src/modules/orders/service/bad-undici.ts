import { request } from 'undici';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const notify = (ctx: unknown, url: string): Promise<unknown> => withTenantTx(ctx, async () => request(url));
