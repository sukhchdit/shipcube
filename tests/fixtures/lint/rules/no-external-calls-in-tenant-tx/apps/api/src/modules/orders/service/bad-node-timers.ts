import * as timers from 'node:timers';
import { setInterval as every, setTimeout as delay } from 'node:timers';
import { setInterval as ticks } from 'node:timers/promises';

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// PR44-SEC-04 X01-X03: the callback timers from node:timers (named alias, namespace, its promises member),
// setInterval from node:timers/promises, and global.setTimeout / globalThis.setInterval.
export const pause = (ctx: unknown): Promise<void> =>
  withTenantTx(ctx, async () => {
    await new Promise((resolve) => delay(resolve, 10));
    await new Promise((resolve) => timers.setTimeout(resolve, 10));
    await timers.promises.setTimeout(10);
    clearInterval(every(() => undefined, 10));
    for await (const tick of ticks(10)) {
      if (tick === undefined) break;
    }
    await new Promise((resolve) => global.setTimeout(resolve, 10));
    clearInterval(globalThis.setInterval(() => undefined, 10));
  });
