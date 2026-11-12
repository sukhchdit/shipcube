interface Operation {
  requestTransaction(transaction: unknown): Promise<unknown>;
}

export const run = (operation: Operation): Promise<unknown> => operation.requestTransaction(null);
