/**
 * The one application module that imports the generated Prisma client as a value (D-ARCH-103 (3), ADR-0003 amendment
 * 2026-11-13; data-model §7.2 amendment; TASK-020 part 020-B). Category `db-root-client` (eslint.config.mjs), like
 * `client.ts`: only apps/*\/src/platform/db, prisma/**, tools/db/** and tests may import it as a value.
 *
 * `@platform/prisma/client` resolves to the composite project prisma/client (D-ARCH-102): the TypeScript sources of
 * the git-ignored prisma/generated/prisma under the `@platform/source` condition (tsc, Jest, tsx), the compiled
 * prisma/dist/client otherwise (`node dist/main.js`, the images). `npm run db:generate` regenerates the client.
 *
 * Exports: the `PrismaClient` class (for platform/db/runtime.ts only), and the types `Prisma`,
 * `AppTransactionClient` (the interactive-transaction client) and `AppDb` (the `TenantDb` every repository receives).
 * `platform/db/index.ts` and `@platform/api/runtime` re-export the three TYPES only, so `Prisma.sql`, `Prisma.raw`
 * and `Prisma.Decimal` have no value path outside platform/db.
 */
import { type Prisma, PrismaClient } from '@platform/prisma/client';

import type { SystemModelName } from './system-models.js';
import type { TenantDb } from './tenant-db.js';

export { PrismaClient };
export type { Prisma };

/** The client of one interactive transaction (`$transaction(async (tx) => ...)`). */
export type AppTransactionClient = Prisma.TransactionClient;

/** What a repository receives inside `withTenantTx`: no `$transaction`, no unsafe raw, no SYSTEM model. */
export type AppDb = TenantDb<AppTransactionClient>;

/**
 * Compile-time proof that every `SYSTEM_MODELS` name is a delegate of the generated client (D-ARCH-103 (3)): a name
 * that is not (a typo, a renamed model) makes this type `false` and the assignment below fails `tsc`, so the type-level
 * and run-time exclusions of tenant-db.ts can never silently exclude nothing.
 */
export type SystemModelsAreDelegates = [SystemModelName] extends [keyof AppTransactionClient] ? true : false;
export const SYSTEM_MODELS_ARE_DELEGATES: SystemModelsAreDelegates = true;
