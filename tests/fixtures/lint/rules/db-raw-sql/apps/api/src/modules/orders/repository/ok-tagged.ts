interface RawClient {
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

export const run = (tx: RawClient, id: string): Promise<unknown> => tx.$queryRaw`SELECT id FROM orders WHERE id = ${id}`;
