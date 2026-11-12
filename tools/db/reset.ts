/**
 * `npm run db:reset -- --yes` — local development reset (data-model.md §4.4 amendment, "migrate dev and migrate
 * reset"): `prisma migrate reset` cannot work against a hardened database, because the migrator owns neither the
 * database nor schema `public`. A reset therefore recreates the database, reruns the bootstrap lane and applies the
 * migrations through the pinned Prisma CLI wrapper:
 *
 *   1. refuse unless `--yes` is given and DATABASE_BOOTSTRAP_URL points at a loopback host (never a shared database);
 *   2. as the bootstrap role on the maintenance database: DROP DATABASE … WITH (FORCE), CREATE DATABASE;
 *   3. tools/db/bootstrap.ts on the new database;
 *   4. `node tools/deps/prisma-cli.mjs migrate deploy` with DATABASE_MIGRATOR_URL.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { BootstrapError, connectPrivileged, readSecret, runBootstrap } from './bootstrap.js';
import { REPO_ROOT } from './lint-migrations.js';
import { quoteIdentifier } from './sql-text.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Validates the reset target; returns the database name. */
export function resetTarget(bootstrapUrl: string | undefined, argv: readonly string[]): { database: string; maintenanceUrl: string } {
  if (!argv.includes('--yes')) throw new BootstrapError('db:reset drops the database; pass --yes to confirm');
  if (bootstrapUrl === undefined || bootstrapUrl === '') throw new BootstrapError('DATABASE_BOOTSTRAP_URL is not set');
  const url = new URL(bootstrapUrl);
  if (!LOOPBACK.has(url.hostname)) throw new BootstrapError(`db:reset only runs against a loopback host, not ${url.hostname}`);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database === '' || database === 'postgres' || database.startsWith('template')) {
    throw new BootstrapError(`db:reset refuses database "${database}"`);
  }
  url.pathname = '/postgres';
  return { database, maintenanceUrl: url.toString() };
}

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const bootstrapUrl = env['DATABASE_BOOTSTRAP_URL'];
    const { database, maintenanceUrl } = resetTarget(bootstrapUrl, argv);
    const vars = {
      migrator_password: readSecret(env, 'BOOTSTRAP_MIGRATOR_PASSWORD'),
      app_password: readSecret(env, 'BOOTSTRAP_APP_PASSWORD'),
    };
    const admin = await connectPrivileged({ connectionString: maintenanceUrl });
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    } finally {
      await admin.end();
    }
    const result = await runBootstrap({ connection: { connectionString: bootstrapUrl as string }, vars });
    process.stdout.write(`[db:reset] ${database} recreated; bootstrap applied ${result.applied.join(', ')}\n`);
    const deploy = spawnSync(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'migrate', 'deploy'], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    return deploy.status === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[db:reset] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
