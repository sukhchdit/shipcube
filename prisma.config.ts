/**
 * Prisma 7 CLI configuration (data-model.md §7.1, ADR-0005). Every CLI call goes through
 * `node tools/deps/prisma-cli.mjs` (ADR-0023 am. J item 2), which pins the schema engine.
 *
 * - The CLI (migrate, db execute) connects as `platform_migrator` through DATABASE_MIGRATOR_URL; the runtime never
 *   sees this URL. `migrate dev` diffs against SHADOW_DATABASE_URL, a database owned by the migrator.
 * - Prisma 7 does not load `.env`: the caller (Compose, CI, the Testcontainers harness) provides the variables.
 *   Commands that need no database (`generate`, `validate`) run without them.
 * - `tables.external` lists objects that live outside Prisma Migrate: the bootstrap-lane ledger
 *   (`public.bootstrap_migrations`, data-model §8.1), the eight audit tables and a generated window of audit partition
 *   names (data-model §7.3 amendment 2026-11-13, SPK-08 F-01; tools/db/audit-external-tables.ts).
 * - `migrations.initShadowDb` is the migrator-runnable rendering of prisma/bootstrap/*.sql (data-model §7.3 amendments
 *   SEC-P3-27 item 6 and 2026-11-13 SPK-08 F-02/F-03, PR12-SEC-07; tools/db/shadow-init.ts), read synchronously here.
 *   Its first statement refuses any database not owned by the current user (42501); it drops and re-creates
 *   `platform`, so SHADOW_DATABASE_URL must name an EMPTY database owned by the migrator. A bootstrap statement the
 *   rendering does not recognise fails the config load (fail closed) for every Prisma command.
 */
import { defineConfig } from 'prisma/config';

import { externalTables } from './tools/db/audit-external-tables.js';
import { shadowInitSql } from './tools/db/shadow-init.js';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];
const shadowUrl = process.env['SHADOW_DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations', initShadowDb: shadowInitSql() },
  datasource: {
    ...(migratorUrl ? { url: migratorUrl } : {}),
    ...(shadowUrl ? { shadowDatabaseUrl: shadowUrl } : {}),
  },
  experimental: { externalTables: true },
  tables: { external: externalTables() },
});
