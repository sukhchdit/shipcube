/**
 * Fixture Prisma config for the rehearsal of a data-changing migration (prisma/tests/migrations/backup-restore.int.test.ts;
 * TASK-034 code review R1-M1): the ROOT schema folder and the generated audit-partition window, as in the root
 * prisma.config.ts, with the migrations folder named by REHEARSAL_MIGRATIONS_PATH (a copy of prisma/migrations plus the
 * migration under rehearsal, so the repository folder is never written). Relative paths resolve against this file's
 * folder; an absolute path stays as it is.
 */
import { defineConfig } from 'prisma/config';

// The audit store (bootstrap lane, TASK-021) lives outside Prisma Migrate, exactly as in the root prisma.config.ts.
import { externalTables } from '../../../../tools/db/audit-external-tables.js';

const migratorUrl = process.env['DATABASE_MIGRATOR_URL'];
const migrationsPath = process.env['REHEARSAL_MIGRATIONS_PATH'];
if (migrationsPath === undefined || migrationsPath === '') throw new Error('REHEARSAL_MIGRATIONS_PATH is not set');

export default defineConfig({
  schema: '../../../schema',
  migrations: { path: migrationsPath },
  datasource: { ...(migratorUrl ? { url: migratorUrl } : {}) },
  experimental: { externalTables: true },
  tables: { external: externalTables() },
});
