/**
 * SPK-08 (TASK-012) throwaway fixture Prisma config: the repository's real schema and migrations, plus the Prisma 7
 * shadow-database init hook `migrations.initShadowDb` (data-model §7.3, batch-0.2 ruling for TASK-012).
 * Relative paths resolve against this file's folder. The test passes, through the environment:
 * - `DATABASE_MIGRATOR_URL` / `SPK08_SHADOW_DATABASE_URL` (migrator connections; the shadow database is migrator-owned),
 * - `SPK08_SHADOW_INIT_FILE`: the rendered, migrator-runnable bootstrap lane (read here as the SQL string the hook takes),
 * - `SPK08_EXTERNAL_TABLES`: comma-separated `tables.external` list.
 */
import { readFileSync } from 'node:fs';

import { defineConfig } from 'prisma/config';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];
const shadowUrl = process.env['SPK08_SHADOW_DATABASE_URL'];
const initFile = process.env['SPK08_SHADOW_INIT_FILE'];
const external = (process.env['SPK08_EXTERNAL_TABLES'] ?? 'public.bootstrap_migrations').split(',');

export default defineConfig({
  schema: '../../../schema',
  migrations: {
    path: process.env['SPK08_MIGRATIONS_DIR'] ?? '../../../migrations',
    ...(initFile ? { initShadowDb: readFileSync(initFile, 'utf8') } : {}),
  },
  datasource: {
    ...(migratorUrl ? { url: migratorUrl } : {}),
    ...(shadowUrl ? { shadowDatabaseUrl: shadowUrl } : {}),
  },
  experimental: { externalTables: true },
  tables: { external },
});
