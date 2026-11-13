import { Queue } from 'bullmq';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// A server package (packages/*/src) gets the rule too; `new` on the import counts as a call.
export const schedule = (ctx: unknown): Promise<unknown> => withTenantTx(ctx, async () => new Queue('tracking'));
