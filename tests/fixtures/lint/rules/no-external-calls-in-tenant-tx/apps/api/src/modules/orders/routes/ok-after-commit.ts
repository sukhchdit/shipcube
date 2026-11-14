interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
  mailer: { send(message: object): Promise<unknown> };
}

declare const deps: Deps;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 (5) positive control: `afterCommit` runs once the tenant transaction has committed, so injected I/O
// (a queue, the mailer) is fine there, in every function form.
export const book = defineRoute({
  operationId: 'bookAfterCommit',
  transaction: 'tenant',
  handler: async () => ({ status: 201, id: 'shipment-1' }),
  afterCommit: async (_ctx: unknown, result: { id: string }) => deps.queue.add('booked', { id: result.id }),
});

export const notify = defineRoute({
  operationId: 'notifyAfterCommit',
  handler: async () => ({ status: 200 }),
  async afterCommit() {
    await deps.mailer.send({ template: 'booked' });
  },
});
