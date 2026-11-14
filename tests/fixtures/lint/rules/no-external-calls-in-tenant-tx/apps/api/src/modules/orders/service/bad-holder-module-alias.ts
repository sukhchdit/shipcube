interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;
declare const deps: Deps;

// Code review R2-m3 / PR44-SEC-11 (b): a module-level const alias of a holder chain is followed like a same-function one.
const jobs = deps.queue;

export const enqueue = (ctx: unknown): Promise<unknown> => withTenantTx(ctx, async () => jobs.add('module-alias', {}));
