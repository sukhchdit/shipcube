import { setTimeout as sleep } from 'node:timers/promises';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

export const wait = (ctx: unknown): Promise<void> => withTenantTx(ctx, async () => sleep(50));
