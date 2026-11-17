interface Deps {
  queue: { add: (name: string, data: unknown) => Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;
declare const deps: Deps;

// Code review R1-n2: a holder method kept as a member alias (module level, bound) and called bare in the transaction.
const bound = deps.queue.add.bind(deps.queue);

export const enqueue = (ctx: unknown, injected: Deps): Promise<unknown> =>
  withTenantTx(ctx, async () => {
    const add = injected.queue.add;
    await add('member-alias', {});
    return bound('bound-alias', {});
  });
