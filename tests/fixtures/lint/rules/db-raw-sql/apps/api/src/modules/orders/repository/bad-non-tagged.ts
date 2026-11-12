interface RawClient {
  $queryRaw(query: unknown): Promise<unknown>;
}

export const run = (tx: RawClient, query: unknown): Promise<unknown> => tx.$queryRaw(query);
