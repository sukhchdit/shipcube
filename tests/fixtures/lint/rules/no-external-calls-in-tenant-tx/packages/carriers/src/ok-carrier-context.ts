interface CarrierContext {
  url: string;
}

interface DatabaseRuntime {
  ping(): Promise<void>;
}

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

type TenantDb = { order: object };

// D-ARCH-106 R6 is type-name based, never parameter-name based: a carrier adapter taking `ctx: CarrierContext` and a
// readiness check taking `db: DatabaseRuntime` are not tenant-transaction roots (T-83 stays silent; the global fetch
// is still the outbound-http-via-client rule's finding), and neither is a function that only receives a callback
// whose parameter is a TenantDb.
export const quote = (ctx: CarrierContext): Promise<Response> => fetch(ctx.url);

export async function ready(db: DatabaseRuntime, deps: Deps): Promise<unknown> {
  await db.ping();
  return deps.queue.add('ready', {});
}

export const schedule = (deps: Deps, work: (db: TenantDb) => Promise<void>): Promise<unknown> => deps.queue.add('work', work);
