import type * as Db from './db-types.js';

type TenantDb<T> = { run(): Promise<T> };

interface Deps {
  queue: { add(name: string, data: unknown): Promise<unknown> };
}

// D-ARCH-106 R6, type-name based: a generic TenantDb<X>, a qualified Db.AppTransactionClient (with a default value),
// and a destructured parameter whose object type holds a TenantDb.
export const generic = (db: TenantDb<string>, deps: Deps): Promise<unknown> => deps.queue.add('generic', db);

export function qualified(deps: Deps, tx: Db.AppTransactionClient = {} as Db.AppTransactionClient): Promise<unknown> {
  return deps.queue.add('qualified', tx);
}

export const destructured = ({ db, deps }: { db: TenantDb<number>; deps: Deps }): Promise<unknown> => deps.queue.add('destructured', db);
