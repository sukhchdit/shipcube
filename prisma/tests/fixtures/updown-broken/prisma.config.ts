/**
 * Fixture Prisma config for the up -> down -> up driver tests: a migration whose down.sql leaves an object behind,
 * which the driver must report (negative control for NT-DATA-004-a).
 */
import { defineConfig } from 'prisma/config';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];

export default defineConfig({
  schema: '../updown/schema',
  migrations: { path: 'migrations' },
  datasource: { ...(migratorUrl ? { url: migratorUrl } : {}) },
  experimental: { externalTables: true },
  tables: { external: ['public.bootstrap_migrations'] },
});
