interface Outbox {
  publish(db: unknown, event: object): Promise<void>;
}

declare const outbox: Outbox;
declare function defineRoute(spec: object): unknown;

// D-ARCH-106 (2) positive control: the outbox is the sanctioned in-transaction effect (never in the `names` option).
export const book = defineRoute({
  operationId: 'bookShipment',
  handler: async (ctx: { db: unknown; id: string }) => outbox.publish(ctx.db, { type: 'shipment.booked', id: ctx.id }),
});
