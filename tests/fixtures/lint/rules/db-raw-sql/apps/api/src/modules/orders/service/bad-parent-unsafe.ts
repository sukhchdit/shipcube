interface Escaped {
  $parent: { $queryRawUnsafe(query: string): Promise<unknown> };
}

export const run = (db: Escaped): Promise<unknown> => db.$parent.$queryRawUnsafe('SELECT 1');
