/**
 * The SYSTEM-class Prisma model delegates (PR19-SEC-01, D-ARCH-080; data-model §1.5 SYSTEM row).
 *
 * The table class comes from the table-class manifests (`tools/db/table-classes/*.json`, class `SYSTEM`); application
 * code may not read `tools/` at run time, so this is a committed copy of that set, mapped to Prisma delegate names
 * (lower-camel model names, the delegate keys of the transaction client). `tools/lint/system-models.test.ts` proves it
 * equals the manifests' SYSTEM tables that have a Prisma model (through `@@map`), and that the
 * `platform/system-model-owner` lint derives the same map, so a new SYSTEM table with a model cannot be forgotten
 * here. SYSTEM tables without a Prisma model (`_prisma_migrations`, `bootstrap_migrations`) have no delegate.
 *
 * Effect: these delegates are absent from `TenantDb` (type and run time) and reachable only through
 * `systemDelegates(tx)` (`./system-db.ts`).
 */
export const SYSTEM_MODELS = ['jobExecution', 'referenceDatasetVersion'] as const;

export type SystemModelName = (typeof SYSTEM_MODELS)[number];
