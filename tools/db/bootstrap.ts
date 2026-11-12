/**
 * Bootstrap lane runner (data-model.md §8.1, §4.4 amendments; ADR-0007 am. 7-8; SEC-P3-27 item 4, SEC-P3-34).
 *
 * Applies `prisma/bootstrap/*.sql` in file-name order with the cluster-admin credential, before `migrate`:
 * - the session runs with `options=-c search_path=pg_catalog,pg_temp`, and `SHOW search_path` is checked before the
 *   first file (a second layer behind each file's own first statement);
 * - each file runs in one transaction together with its ledger row in `public.bootstrap_migrations`
 *   (file_name, sha256, applied_at, applied_by), owned by the bootstrap role with no grant to any platform role;
 * - an applied file is skipped when its SHA-256 is unchanged; a changed, deleted or out-of-order file fails the run;
 * - psql-style variables (`:'name'`, `:"name"`) are substituted from the caller's values; `db_name` is reserved and
 *   always set to `current_database()`. Values never reach a log line or an error message.
 * - concurrent runners serialise on an advisory lock.
 *
 * CLI (`npm run db:bootstrap`): DATABASE_BOOTSTRAP_URL plus BOOTSTRAP_MIGRATOR_PASSWORD and BOOTSTRAP_APP_PASSWORD
 * (or the `*_FILE` variants naming Compose secret files). Exit 0 = applied or up to date, 1 = failure.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { referencedVariables, substituteVariables } from './sql-text.js';

export const BOOTSTRAP_SEARCH_PATH = 'pg_catalog, pg_temp';
/** libpq `options` value every privileged session uses (SEC-P3-27 item 4, SEC-P3-34 item 2). */
export const PRIVILEGED_SESSION_OPTIONS = '-c search_path=pg_catalog,pg_temp';
export const LEDGER_TABLE = 'public.bootstrap_migrations';
/** Reserved variable, always `current_database()`. */
export const DB_NAME_VARIABLE = 'db_name';
const FILE_NAME = /^\d{2}-[a-z0-9-]+\.sql$/;
/** Advisory-lock key: the first 8 bytes of SHA-256("platform:bootstrap-lane"), as a signed bigint. */
const LOCK_KEY = createHash('sha256').update('platform:bootstrap-lane').digest().readBigInt64BE(0).toString();

export const DEFAULT_BOOTSTRAP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'bootstrap');

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapFile {
  name: string;
  sql: string;
  sha256: Buffer;
}

/** Bootstrap files of `dir` in byte order of their names. */
export function listBootstrapFiles(dir: string): BootstrapFile[] {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map((name) => {
    if (!FILE_NAME.test(name)) throw new BootstrapError(`bootstrap file name ${name} does not match NN-name.sql`);
    const bytes = readFileSync(join(dir, name));
    return { name, sql: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest() };
  });
}

export interface BootstrapOptions {
  /** Cluster-admin connection. Must not carry its own `options`; the runner sets the search path. */
  connection: Omit<pg.ClientConfig, 'options'>;
  /** Variable values (passwords from the secret manager). `db_name` is reserved. */
  vars: Readonly<Record<string, string>>;
  dir?: string;
  log?: (line: string) => void;
}

export interface BootstrapResult {
  database: string;
  applied: string[];
  skipped: string[];
}

/** Opens a privileged session pinned to `pg_catalog, pg_temp` and checks the effective path. */
export async function connectPrivileged(connection: Omit<pg.ClientConfig, 'options'>): Promise<pg.Client> {
  if (typeof connection.connectionString === 'string' && /[?&]options=/i.test(connection.connectionString)) {
    throw new BootstrapError('the bootstrap connection string must not carry an options parameter');
  }
  const client = new pg.Client({ ...connection, options: PRIVILEGED_SESSION_OPTIONS });
  await client.connect();
  try {
    const { rows } = await client.query<{ search_path: string }>('SHOW search_path');
    if (rows[0]?.search_path.replace(/\s+/g, '') !== BOOTSTRAP_SEARCH_PATH.replace(/\s+/g, '')) {
      throw new BootstrapError(
        `privileged session search_path is ${JSON.stringify(rows[0]?.search_path)}, expected ${BOOTSTRAP_SEARCH_PATH}`,
      );
    }
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}

const describe = (error: unknown): string => {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.message} (SQLSTATE ${code})` : error.message;
  }
  return String(error);
};

/** Applies pending bootstrap files. Throws `BootstrapError` on any integrity or execution failure. */
export async function runBootstrap(options: BootstrapOptions): Promise<BootstrapResult> {
  const log = options.log ?? (() => {});
  if (Object.hasOwn(options.vars, DB_NAME_VARIABLE)) throw new BootstrapError(`variable ${DB_NAME_VARIABLE} is reserved`);
  const files = listBootstrapFiles(options.dir ?? DEFAULT_BOOTSTRAP_DIR);
  const client = await connectPrivileged(options.connection);
  try {
    const database = (await client.query<{ db: string }>('SELECT pg_catalog.current_database() AS db')).rows[0]?.db ?? '';
    const vars: Record<string, string> = { ...options.vars, [DB_NAME_VARIABLE]: database };
    // Fail fast on a missing variable before anything is applied.
    for (const file of files) {
      const missing = referencedVariables(file.sql).filter((name) => vars[name] === undefined);
      if (missing.length > 0) throw new BootstrapError(`${file.name} needs variable(s) ${missing.join(', ')}`);
    }

    await client.query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
        file_name  text        PRIMARY KEY,
        sha256     bytea       NOT NULL CHECK (pg_catalog.octet_length(sha256) = 32),
        applied_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
        applied_by text        NOT NULL DEFAULT CURRENT_USER
      )`);
    await client.query(`REVOKE ALL ON TABLE ${LEDGER_TABLE} FROM PUBLIC`);
    const ledger = new Map(
      (await client.query<{ file_name: string; sha256: Buffer }>(`SELECT file_name, sha256 FROM ${LEDGER_TABLE}`)).rows.map(
        (row) => [row.file_name, row.sha256] as const,
      ),
    );

    const present = new Set(files.map((file) => file.name));
    const vanished = [...ledger.keys()].filter((name) => !present.has(name)).sort();
    if (vanished.length > 0) throw new BootstrapError(`applied bootstrap file(s) missing from the lane: ${vanished.join(', ')}`);
    const lastApplied = [...ledger.keys()].sort().at(-1);

    const result: BootstrapResult = { database, applied: [], skipped: [] };
    for (const file of files) {
      const recorded = ledger.get(file.name);
      if (recorded !== undefined) {
        if (!recorded.equals(file.sha256)) {
          throw new BootstrapError(
            `${file.name} changed after it was applied (ledger sha256 ${recorded.toString('hex')}, file ${file.sha256.toString('hex')}); bootstrap files are immutable, add a new file`,
          );
        }
        result.skipped.push(file.name);
        continue;
      }
      if (lastApplied !== undefined && file.name < lastApplied) {
        throw new BootstrapError(`${file.name} sorts before the already applied ${lastApplied}; a new bootstrap file must sort last`);
      }
      const sql = substituteVariables(file.sql, vars);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`INSERT INTO ${LEDGER_TABLE} (file_name, sha256) VALUES ($1, $2)`, [file.name, file.sha256]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new BootstrapError(`${file.name} failed: ${describe(error)}`);
      }
      log(`[bootstrap] applied ${file.name} to ${database}`);
      result.applied.push(file.name);
    }
    return result;
  } finally {
    await client.end();
  }
}

/**
 * Re-applies the database-level part of `00-roles.sql` to a database created from a template (template cloning copies
 * schemas and objects but not the database ACL, owner or role-in-database settings). The file is idempotent; the
 * ledger, copied from the template, is not touched.
 */
export async function reapplyDatabaseLevel(options: BootstrapOptions & { file?: string }): Promise<void> {
  const fileName = options.file ?? '00-roles.sql';
  const file = listBootstrapFiles(options.dir ?? DEFAULT_BOOTSTRAP_DIR).find((candidate) => candidate.name === fileName);
  if (file === undefined) throw new BootstrapError(`bootstrap file ${fileName} not found`);
  const client = await connectPrivileged(options.connection);
  try {
    const database = (await client.query<{ db: string }>('SELECT pg_catalog.current_database() AS db')).rows[0]?.db ?? '';
    const sql = substituteVariables(file.sql, { ...options.vars, [DB_NAME_VARIABLE]: database });
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new BootstrapError(`${file.name} failed on ${database}: ${describe(error)}`);
    }
  } finally {
    await client.end();
  }
}

/** Secret from `NAME` or from the file named by `NAME_FILE` (Compose secrets); never logged. */
export function readSecret(env: NodeJS.ProcessEnv, name: string): string {
  const direct = env[name];
  if (direct !== undefined && direct !== '') return direct;
  const file = env[`${name}_FILE`];
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  throw new BootstrapError(`${name} (or ${name}_FILE) is not set`);
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const connectionString = env['DATABASE_BOOTSTRAP_URL'];
    if (connectionString === undefined || connectionString === '') throw new BootstrapError('DATABASE_BOOTSTRAP_URL is not set');
    const result = await runBootstrap({
      connection: { connectionString },
      vars: {
        migrator_password: readSecret(env, 'BOOTSTRAP_MIGRATOR_PASSWORD'),
        app_password: readSecret(env, 'BOOTSTRAP_APP_PASSWORD'),
      },
      log: (line) => process.stdout.write(`${line}\n`),
    });
    process.stdout.write(`[bootstrap] ${result.database}: ${result.applied.length} applied, ${result.skipped.length} up to date\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[bootstrap] ${describe(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
