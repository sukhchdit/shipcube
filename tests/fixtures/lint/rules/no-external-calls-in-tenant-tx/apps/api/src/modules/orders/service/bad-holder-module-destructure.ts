interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

declare function withTenantTx<T>(ctx: unknown, fn: (db: unknown) => Promise<T>): Promise<T>;
declare const deps: Deps;

// Code review R2-m3 / PR44-SEC-11 (b): a module-level destructuring alias of a names key is followed too.
const { queue: work } = deps;

export const enqueue = (ctx: unknown): Promise<unknown> => withTenantTx(ctx, async () => work.add('module-destructure', {}));
