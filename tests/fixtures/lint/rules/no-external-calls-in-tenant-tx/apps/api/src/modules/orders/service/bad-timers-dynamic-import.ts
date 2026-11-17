declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;

// PR44-SEC-14 (T-83): a literal import() of a timer module inside a root is a sleep (whatever is done with it).
export const pause = (ctx: unknown): Promise<void> =>
  withTenantTx(ctx, async () => {
    await (await import('node:timers/promises')).setTimeout(10);
    const timers = await import('timers/promises');
    await timers.scheduler.wait(10);
    await new Promise((resolve) => {
      void import(`node:timers`).then((loaded) => loaded.setTimeout(resolve, 10));
    });
  });
