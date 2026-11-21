/**
 * PostgreSQL 18 Testcontainers harness (TEST-STRATEGY §10.2; data-model.md §4.6, §8.4; TASK-003).
 *
 * - One container per test file, image pinned by digest (`POSTGRES_IMAGE`, the SPK-01 image).
 * - The superuser password and the platform role passwords are random per run; nothing secret-shaped is committed.
 * - Template-database cloning: a database is bootstrapped (and optionally migrated) once, and tests get clones.
 *   `CREATE DATABASE … TEMPLATE` copies schemas and objects but not the database ACL, owner or role-in-database
 *   settings, so every clone re-runs the idempotent `00-roles.sql` (`reapplyDatabaseLevel`).
 * - Privileged sessions always connect with `options=-c search_path=pg_catalog,pg_temp` (SEC-P3-34 item 2).
 * - Application code connects as the runtime role `platform_app`, never as the migrator (REQ-RLS-005).
 * - Every Prisma CLI call goes through tools/deps/prisma-cli.mjs (ADR-0023 am. J item 2 (d)) under the shared
 *   `PRISMA_TREE_LOCK`, because the engine acceptance test replaces the engine file meanwhile.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { PRIVILEGED_SESSION_OPTIONS, reapplyDatabaseLevel, runBootstrap, type BootstrapResult } from '../../../tools/db/bootstrap.js';
import { quoteIdentifier } from '../../../tools/db/sql-text.js';
import { PRISMA_TREE_LOCK, withFileLock } from '../../../tools/test-support/fs-lock.js';
import { findRepoRoot, runNode, type RunResult } from '../../../tools/test-support/process.js';

/** `postgres:18` (18.6) as recorded by SPK-01. */
export const POSTGRES_IMAGE = 'postgres:18@sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42';
export const SUPERUSER = 'postgres';
export const MIGRATOR = 'platform_migrator';
export const APP_ROLE = 'platform_app';

const repoRoot = findRepoRoot();
const prismaCli = join(repoRoot, 'tools', 'deps', 'prisma-cli.mjs');

/** 32 random bytes, URL-safe: usable in a connection URL without escaping. */
export const randomSecret = (): string => randomBytes(32).toString('base64url');

export interface PrismaOptions {
  /** Prisma config file (default: the repository's prisma.config.ts). */
  config?: string;
  /** Extra variables for the CLI (a fixture config's inputs, e.g. REHEARSAL_MIGRATIONS_PATH). */
  env?: Readonly<Record<string, string>>;
}

export class PlatformPostgres {
  readonly passwords = { migrator: randomSecret(), app: randomSecret() };
  private readonly templates = new Map<string, Promise<string>>();
  private sequence = 0;

  private constructor(
    readonly container: StartedPostgreSqlContainer,
    private readonly superuserPassword: string,
  ) {}

  /** Starts a fresh PostgreSQL 18 container; `serverSettings` become `postgres -c name=value` arguments. */
  static async start(serverSettings: Readonly<Record<string, string>> = {}): Promise<PlatformPostgres> {
    const password = randomSecret();
    const settings = Object.entries(serverSettings).flatMap(([name, value]) => ['-c', `${name}=${value}`]);
    let container = new PostgreSqlContainer(POSTGRES_IMAGE).withUsername(SUPERUSER).withPassword(password).withDatabase('postgres');
    if (settings.length > 0) container = container.withCommand(['postgres', ...settings]);
    return new PlatformPostgres(await container.start(), password);
  }

  get host(): string {
    return this.container.getHost();
  }

  get port(): number {
    return this.container.getPort();
  }

  /**
   * Privileged (bootstrap-role) connection settings; the runner adds the pinned search path itself. A URL, because
   * connectPrivileged refuses a config without one (PR5-SEC-14, TASK-034); the password is random base64url.
   */
  bootstrapConnection(database: string): { connectionString: string } {
    const credentials = `${SUPERUSER}:${encodeURIComponent(this.superuserPassword)}`;
    return { connectionString: `postgresql://${credentials}@${this.host}:${String(this.port)}/${encodeURIComponent(database)}` };
  }

  /** A privileged session with the pinned search path (SEC-P3-34 item 2). */
  async superuser(database: string): Promise<pg.Client> {
    const client = new pg.Client({ ...this.bootstrapConnection(database), options: PRIVILEGED_SESSION_OPTIONS });
    await client.connect();
    return client;
  }

  /** Runtime-role connection settings (`platform_app`). */
  appConnection(database: string): pg.ClientConfig {
    return { host: this.host, port: this.port, user: APP_ROLE, password: this.passwords.app, database };
  }

  appUrl(database: string): string {
    return `postgresql://${APP_ROLE}:${this.passwords.app}@${this.host}:${this.port}/${database}`;
  }

  migratorConnection(database: string): pg.ClientConfig {
    return { host: this.host, port: this.port, user: MIGRATOR, password: this.passwords.migrator, database };
  }

  migratorUrl(database: string): string {
    return `postgresql://${MIGRATOR}:${this.passwords.migrator}@${this.host}:${this.port}/${database}`;
  }

  async createDatabase(name: string, template?: string): Promise<void> {
    const admin = await this.superuser('postgres');
    try {
      await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}${template ? ` TEMPLATE ${quoteIdentifier(template)}` : ''}`);
    } finally {
      await admin.end();
    }
  }

  async bootstrap(database: string, dir?: string): Promise<BootstrapResult> {
    return runBootstrap({ connection: this.bootstrapConnection(database), passwords: this.passwords, ...(dir ? { dir } : {}) });
  }

  /** Runs the Prisma CLI through the pinned-engine wrapper against `database` as the migrator. */
  async prisma(database: string, args: readonly string[], options: PrismaOptions = {}): Promise<RunResult> {
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, DATABASE_MIGRATOR_URL: this.migratorUrl(database) };
    delete env['SHADOW_DATABASE_URL'];
    const config = options.config ? ['--config', options.config] : [];
    return withFileLock(PRISMA_TREE_LOCK, () => runNode([prismaCli, ...args, ...config], { cwd: repoRoot, env, timeoutMs: 180_000 }));
  }

  /** Marks a finished migration as rolled back (see tools/db/up-down-up.ts). */
  async markRolledBack(database: string, migration: string): Promise<void> {
    const client = new pg.Client(this.migratorConnection(database));
    await client.connect();
    try {
      const result = await client.query(
        `UPDATE public._prisma_migrations SET rolled_back_at = pg_catalog.now()
          WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        [migration],
      );
      if (result.rowCount !== 1) throw new Error(`expected one applied row for ${migration}, updated ${String(result.rowCount)}`);
    } finally {
      await client.end();
    }
  }

  /** `pg_dump --schema-only` of `database`, run inside the container as the superuser. */
  async dumpSchema(database: string): Promise<string> {
    const result = await this.container.exec(['pg_dump', '--schema-only', '--username', SUPERUSER, '--dbname', database]);
    if (result.exitCode !== 0) throw new Error(`pg_dump ${database} failed: ${result.stderr || result.output}`);
    return result.stdout;
  }

  /**
   * A bootstrapped (and, with `migrated`, fully migrated) template database, built once per container.
   * Returns its name; clone it with `clone()`.
   */
  template(options: { migrated: boolean }): Promise<string> {
    const key = options.migrated ? 'platform_tpl_migrated' : 'platform_tpl_bootstrapped';
    let pending = this.templates.get(key);
    if (pending === undefined) {
      pending = (async () => {
        await this.createDatabase(key);
        await this.bootstrap(key);
        if (options.migrated) {
          const deploy = await this.prisma(key, ['migrate', 'deploy']);
          if (deploy.status !== 0) throw new Error(`migrate deploy on ${key} failed: ${deploy.stderr || deploy.stdout}`);
        }
        return key;
      })();
      this.templates.set(key, pending);
    }
    return pending;
  }

  /** A fresh database cloned from `template`, with the database-level bootstrap re-applied. */
  async clone(template: string): Promise<string> {
    this.sequence += 1;
    const name = `t_${String(this.sequence).padStart(3, '0')}_${randomBytes(3).toString('hex')}`;
    await this.createDatabase(name, template);
    await reapplyDatabaseLevel({ connection: this.bootstrapConnection(name), passwords: this.passwords });
    return name;
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }
}
