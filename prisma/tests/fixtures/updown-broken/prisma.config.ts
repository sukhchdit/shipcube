/**
 * Fixture Prisma config for the up -> down -> up driver tests: a migration whose down.sql leaves an object behind,
 * which the driver must report (negative control for NT-DATA-004-a).
 */
import { defineConfig } from 'prisma/config';

// The audit store (bootstrap lane, TASK-021) lives outside Prisma Migrate, exactly as in the root prisma.config.ts.
import { externalTables } from '../../../../tools/db/audit-external-tables.js';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];

export default defineConfig({
  schema: '../updown/schema',
  migrations: { path: 'migrations' },
  datasource: { ...(migratorUrl ? { url: migratorUrl } : {}) },
  experimental: { externalTables: true },
  tables: { external: externalTables() },
});
