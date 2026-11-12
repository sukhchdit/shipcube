/**
 * Fixture Prisma config for the rule-5 probe (prisma/tests/migrations/concurrent-index.int.test.ts; data-model §8.3
 * rule 5): how `prisma migrate deploy` submits a migration that holds CREATE INDEX CONCURRENTLY. Same shape as the
 * root prisma.config.ts. Relative paths resolve against this file's folder.
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
