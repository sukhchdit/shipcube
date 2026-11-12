interface Tx {
  order: {
    updateMany(args: object): Promise<{ count: number }>;
    deleteMany(args: object): Promise<{ count: number }>;
  };
}

declare function expectAffected(result: { count: number }, expected: number): void;

export async function transition(tx: Tx): Promise<void> {
  const result = await tx.order.updateMany({});
  expectAffected(result, 1);
  expectAffected(await tx.order.deleteMany({}), 1);
}
