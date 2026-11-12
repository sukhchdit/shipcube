interface RawClient {
  $queryRawUnsafe(query: string): Promise<unknown>;
}

export const run = (db: RawClient): Promise<unknown> => {
  const { $queryRawUnsafe } = db;
  return $queryRawUnsafe('SELECT 1');
};
