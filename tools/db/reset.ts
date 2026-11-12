/**
 * `npm run db:reset -- --yes` — local development reset (data-model.md §4.4 amendment, "migrate dev and migrate
 * reset"): `prisma migrate reset` cannot work against a hardened database, because the migrator owns neither the
 * database nor schema `public`. A reset therefore recreates the database, reruns the bootstrap lane and applies the
 * migrations through the pinned Prisma CLI wrapper:
 *
 *   1. refuse unless `--yes` is given, DATABASE_BOOTSTRAP_URL resolves (as `pg` resolves it) to a loopback host or a
 *      Unix socket, and DATABASE_MIGRATOR_URL resolves to the same host, port and database (never a shared database);
 *   2. as the bootstrap role on the maintenance database: DROP DATABASE … WITH (FORCE), CREATE DATABASE;
 *   3. tools/db/bootstrap.ts on the new database;
 *   4. `node tools/deps/prisma-cli.mjs migrate deploy` with DATABASE_MIGRATOR_URL.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { parse } from 'pg-connection-string';

import { BootstrapError, connectPrivileged, readRolePasswords, runBootstrap } from './bootstrap.js';
import { REPO_ROOT } from './lint-migrations.js';
import { quoteIdentifier } from './sql-text.js';

const LOOPBACK = new Set(['localhost', '::1']);
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/** Query parameters that would override the URL's host for `pg` (pg-connection-string gives `host` precedence). */
const HOST_OVERRIDES = new Set(['host', 'hostaddr']);
const ADMIN_STATEMENT_TIMEOUT = '60s';
const DEPLOY_TIMEOUT_MS = 10 * 60_000;

export interface Endpoint {
  host: string;
  port: string;
  database: string;
}

/** The endpoint `pg` connects to for `url`, parsed with pg-connection-string. Messages never echo the URL. */
export function effectiveEndpoint(url: string, name: string): Endpoint {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new BootstrapError(`${name} is not a valid URL`);
  }
  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new BootstrapError(`${name} must be a postgres:// or postgresql:// URL`);
  }
  if ([...parsedUrl.searchParams.keys()].some((key) => HOST_OVERRIDES.has(key.toLowerCase()))) {
    throw new BootstrapError(`db:reset refuses host/hostaddr query parameters in ${name}`);
  }
  const parsed = parse(url);
  const host = parsed.host ?? '';
  if (host === '') throw new BootstrapError(`${name} names no host`);
  return { host, port: parsed.port || '5432', database: parsed.database ?? '' };
}

const isLocal = (host: string): boolean => host.startsWith('/') || LOOPBACK.has(host.toLowerCase()) || LOOPBACK_V4.test(host);

/** Validates the reset target; returns the database name and the maintenance-database URL. */
export function resetTarget(
  bootstrapUrl: string | undefined,
  argv: readonly string[],
  migratorUrl: string | undefined,
): { database: string; maintenanceUrl: string } {
  if (!argv.includes('--yes')) throw new BootstrapError('db:reset drops the database; pass --yes to confirm');
  if (bootstrapUrl === undefined || bootstrapUrl === '') throw new BootstrapError('DATABASE_BOOTSTRAP_URL is not set');
  const target = effectiveEndpoint(bootstrapUrl, 'DATABASE_BOOTSTRAP_URL');
  if (!isLocal(target.host)) {
    throw new BootstrapError(`db:reset only runs against a loopback host or a Unix socket, not ${target.host}`);
  }
  const { database } = target;
  if (database === '' || database === 'postgres' || database.startsWith('template')) {
    throw new BootstrapError(`db:reset refuses database "${database}"`);
  }
  if (migratorUrl === undefined || migratorUrl === '') throw new BootstrapError('DATABASE_MIGRATOR_URL is not set');
  const migrator = effectiveEndpoint(migratorUrl, 'DATABASE_MIGRATOR_URL');
  if (migrator.host !== target.host || migrator.port !== target.port || migrator.database !== database) {
    throw new BootstrapError('DATABASE_MIGRATOR_URL must name the same host, port and database as DATABASE_BOOTSTRAP_URL');
  }
  const url = new URL(bootstrapUrl);
  url.pathname = '/postgres';
  return { database, maintenanceUrl: url.toString() };
}

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const bootstrapUrl = env['DATABASE_BOOTSTRAP_URL'];
    const { database, maintenanceUrl } = resetTarget(bootstrapUrl, argv, env['DATABASE_MIGRATOR_URL']);
    const passwords = readRolePasswords(env);
    const admin = await connectPrivileged({ connectionString: maintenanceUrl });
    try {
      await admin.query(`SET statement_timeout = '${ADMIN_STATEMENT_TIMEOUT}'`);
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    } finally {
      await admin.end();
    }
    const result = await runBootstrap({ connection: { connectionString: bootstrapUrl }, passwords });
    process.stdout.write(`[db:reset] ${database} recreated; bootstrap applied ${result.applied.join(', ')}\n`);
    const deploy = spawnSync(process.execPath, [join(REPO_ROOT, 'tools', 'deps', 'prisma-cli.mjs'), 'migrate', 'deploy'], {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      timeout: DEPLOY_TIMEOUT_MS,
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
