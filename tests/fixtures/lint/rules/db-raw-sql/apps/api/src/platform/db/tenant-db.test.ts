interface RawClient {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export const probe = (tx: RawClient): Promise<unknown> => tx.$queryRawUnsafe('SELECT 1');
