/**
 * Fixture Prisma config for the up -> down -> up driver tests (tools/db/up-down-up.ts): a reversible migration set.
 * Same shape as the root prisma.config.ts. Relative paths resolve against this file's folder.
 */
import { defineConfig } from 'prisma/config';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];

export default defineConfig({
  schema: 'schema',
  migrations: { path: 'migrations' },
  datasource: { ...(migratorUrl ? { url: migratorUrl } : {}) },
  experimental: { externalTables: true },
  tables: { external: ['public.bootstrap_migrations'] },
});
