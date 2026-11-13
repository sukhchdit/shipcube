type TenantDb = { order: { update(data: object): Promise<unknown> } };

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

// D-ARCH-106 R6: a service method with `db: TenantDb` enqueues through an injected queue.
export const ordersService = (deps: Deps) => ({
  async cancel(db: TenantDb, id: string): Promise<unknown> {
    await db.order.update({ id });
    return deps.queue.add('cancel', { id });
  },
});
