type TenantDb = { order: { update(data: object): Promise<unknown> } };

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

// D-ARCH-111 (e): a class constructed with a tenant transaction handle runs its methods inside the transaction, so
// every method (and a function-valued field) is a root, not only the constructor.
export class OrdersRepository {
  constructor(
    private readonly db: TenantDb,
    private readonly deps: Deps,
  ) {}

  async cancel(id: string): Promise<unknown> {
    await this.db.order.update({ id });
    return this.deps.queue.add('cancel', { id });
  }

  readonly archive = async (id: string): Promise<unknown> => this.deps.queue.add('archive', { id });
}
