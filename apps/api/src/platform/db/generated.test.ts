/**
 * platform/db/generated.ts, the one value importer of `@platform/prisma/client` (D-ARCH-103 (3); TASK-020 part 020-B).
 * Resolution mode 2 of D-ARCH-102: under Jest the `@platform/source` condition serves the generated TypeScript, and the
 * client is constructed over the `pg` driver adapter without a database (construction opens no connection). The
 * type-level cases are checked by `tsc -b` (the typecheck gate), which compiles this file.
 */
import { describe, expect, it } from '@jest/globals';

import { createDatabaseAdapter, createDatabasePool } from './client.js';
import {
  type AppDb,
  type AppTransactionClient,
  PrismaClient,
  SYSTEM_MODELS_ARE_DELEGATES,
  type SystemModelsAreDelegates,
} from './generated.js';
import { SYSTEM_MODELS } from './system-models.js';

// Type-level: the AppDb a repository receives has no $transaction and no SYSTEM model; the transaction client has both
// the delegates and the raw tagged templates.
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
const appDbHasNoTransaction: HasKey<AppDb, '$transaction'> = false;
const appDbHasNoSystemModel: HasKey<AppDb, 'referenceDatasetVersion'> = false;
const appDbHasGlobalCatalogue: HasKey<AppDb, 'permission'> = true;
const txHasSystemModel: HasKey<AppTransactionClient, 'referenceDatasetVersion'> = true;
// @ts-expect-error TASK-020 part 020-B: AppDb omits $transaction (a nested transaction would escape the tenant context).
const noNested = (db: AppDb): unknown => db.$transaction;
// @ts-expect-error TASK-020 part 020-B: AppDb omits SYSTEM models; they are reached only through systemDelegates(tx).
const noSystem = (db: AppDb): unknown => db.referenceDatasetVersion;
const proof: SystemModelsAreDelegates = true;

describe('generated.ts (D-ARCH-103 (3))', () => {
  it('pins the type-level facts (compiled by tsc -b)', () => {
    expect([appDbHasNoTransaction, appDbHasNoSystemModel, appDbHasGlobalCatalogue, txHasSystemModel, proof]).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect([typeof noNested, typeof noSystem]).toEqual(['function', 'function']);
    expect(SYSTEM_MODELS_ARE_DELEGATES).toBe(true);
  });

  it('constructs the generated client over the pg driver adapter without a database, and every SYSTEM model is a delegate', async () => {
    // A pool to a port nothing listens on: construction and $disconnect never connect.
    const pool = createDatabasePool({ connectionString: 'postgresql://probe@127.0.0.1:1/probe', poolMax: 1, applicationName: 'unit' });
    const client = new PrismaClient({ adapter: createDatabaseAdapter(pool), errorFormat: 'minimal' });
    try {
      expect(typeof client.$transaction).toBe('function');
      for (const model of SYSTEM_MODELS) expect(typeof client[model].findMany).toBe('function');
      expect(typeof client.permission.findMany).toBe('function');
    } finally {
      await client.$disconnect();
      await pool.end();
    }
  });
});
