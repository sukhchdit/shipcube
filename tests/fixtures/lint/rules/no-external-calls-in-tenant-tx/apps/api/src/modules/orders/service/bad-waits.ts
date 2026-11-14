import { scheduler as pause } from 'node:timers/promises';
import * as timers from 'node:timers/promises';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// D-ARCH-111 (f): scheduler.wait (any local name, named or namespace import) and Atomics.wait join the sleeps.
export const wait = (ctx: unknown, cell: Int32Array): Promise<void> =>
  withTenantTx(ctx, async () => {
    await pause.wait(10);
    await timers.scheduler.wait(10);
    Atomics.wait(cell, 0, 0, 10);
  });
