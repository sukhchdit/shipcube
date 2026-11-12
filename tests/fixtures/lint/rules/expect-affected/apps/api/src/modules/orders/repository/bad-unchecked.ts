interface Tx {
  order: { updateMany(args: object): Promise<{ count: number }> };
}

export async function voidLabel(tx: Tx): Promise<void> {
  await tx.order.updateMany({});
}
