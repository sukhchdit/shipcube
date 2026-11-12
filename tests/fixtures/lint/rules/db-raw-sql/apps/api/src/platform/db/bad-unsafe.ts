interface RawClient {
  $executeRawUnsafe(query: string): Promise<number>;
}

export const run = (tx: RawClient): Promise<number> => tx.$executeRawUnsafe('SELECT 1');
