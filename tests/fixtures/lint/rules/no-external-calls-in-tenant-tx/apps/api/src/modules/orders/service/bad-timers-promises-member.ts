import { promises } from 'node:timers';
import { promises as tp } from 'timers';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// PR44-SEC-14 (T-83): the promises member of node:timers / timers imported by name (plain and renamed).
export const pause = (ctx: unknown): Promise<void> =>
  withTenantTx(ctx, async () => {
    await promises.setTimeout(10);
    await tp.setTimeout(10);
    await tp.scheduler.wait(10);
  });
