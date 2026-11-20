/**
 * Test helper (TASK-043, lane B only): a PostgreSQL 18 container prepared as the Compose migrate job prepares it, the
 * bootstrap-lane CLI (`tools/db/bootstrap.ts`: roles, the audit store) then `prisma migrate deploy` through the
 * pinned-engine wrapper, both run as child processes (the apps may not import the prisma/tests harness; the
 * composition.int.test.ts pattern). Passwords are random per run. Never imported by production code.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

/** Same pinned image as prisma/tests/harness/postgres.ts (SPK-01). */
const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
const DATABASE = 'platform';
const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const CHILD_DEADLINE_MS = 180_000;

const secret = (): string => randomBytes(24).toString('hex');

export interface MigratedPostgres {
  readonly container: StartedPostgreSqlContainer;
  /** `platform_app` (the runtime role). */
  readonly appUrl: string;
  /** A privileged session with the pinned search path; the caller ends it. */
  superuser(): Promise<pg.Client>;
  stop(): Promise<void>;
}

function run(args: readonly string[], env: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.resume();
    const timer = setTimeout(() => child.kill(), CHILD_DEADLINE_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} exited ${String(code)}: ${stderr.slice(0, 2_000)}`));
    });
  });
}

export async function startMigratedPostgres(): Promise<MigratedPostgres> {
  const superuserPassword = secret();
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withUsername('postgres')
    .withPassword(superuserPassword)
    .withDatabase(DATABASE)
    .start();
  const host = container.getHost();
  const port = String(container.getPort());
  const passwords = { migrator: secret(), app: secret() };
  const tsx = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  await run(
    [tsx, '--conditions=@platform/source', join('tools', 'db', 'bootstrap.ts')],
    {
      APP_ENV: 'test',
      DATABASE_BOOTSTRAP_URL: `postgresql://postgres:${superuserPassword}@${host}:${port}/${DATABASE}`,
      BOOTSTRAP_MIGRATOR_PASSWORD: passwords.migrator,
      BOOTSTRAP_APP_PASSWORD: passwords.app,
    },
    'db:bootstrap',
  );
  const migrate: NodeJS.ProcessEnv = {
    DATABASE_MIGRATOR_URL: `postgresql://platform_migrator:${passwords.migrator}@${host}:${port}/${DATABASE}`,
  };
  await run(
    [join('tools', 'deps', 'prisma-cli.mjs'), 'migrate', 'deploy'],
    { ...migrate, SHADOW_DATABASE_URL: '' },
    'prisma migrate deploy',
  );
  return {
    container,
    appUrl: `postgresql://platform_app:${passwords.app}@${host}:${port}/${DATABASE}?sslmode=disable`,
    async superuser() {
      const client = new pg.Client({
        host,
        port: Number(port),
        user: 'postgres',
        password: superuserPassword,
        database: DATABASE,
        options: '-c search_path=pg_catalog,pg_temp',
      });
      await client.connect();
      return client;
    },
    stop: async () => {
      await container.stop();
    },
  };
}
