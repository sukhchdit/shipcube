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
 * - the role passwords (`migrator_password`, `app_password`) are reserved too: they come from `passwords` and are
 *   substituted as client-side SCRAM-SHA-256 verifiers, so the plaintext never reaches the server or its log
 *   (PR5-SEC-01, tools/db/scram.ts).
 * - concurrent runners serialise on an advisory lock, waited for at most `lockTimeoutMs`; the connection attempt,
 *   every file and every query are bounded too, the socket keeps TCP keep-alive on, and a connection-level `'error'`
 *   event writes one value-free line instead of crashing the process (CLAUDE.md §9; PR #13 R2-n2/-n3/m1);
 * - TLS is the platform's one implementation (`databaseConnectionSettings` in @platform/config, PR13-SEC-09): pg gets
 *   the URL without its query plus an explicit `ssl`, so neither the URL, `PGSSLMODE` nor
 *   `NODE_TLS_REJECT_UNAUTHORIZED` decides it.
 *
 * CLI (`npm run db:bootstrap`): DATABASE_BOOTSTRAP_URL plus BOOTSTRAP_MIGRATOR_PASSWORD and BOOTSTRAP_APP_PASSWORD
 * (or the `*_FILE` variants naming Compose secret files); `checkToolingEnv` runs first (PR3-SEC-14). Exit 0 = applied
 * or up to date, 1 = failure.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkToolingEnv,
  DATABASE_CA_DIRECTORIES,
  databaseConnectionSettings,
  DatabaseConfigError,
  formatToolingIssues,
} from '@platform/config';
import pg from 'pg';

import { ScramPasswordError, scramSha256Verifier } from './scram.js';
import { referencedVariables, substituteVariables } from './sql-text.js';

export const BOOTSTRAP_SEARCH_PATH = 'pg_catalog, pg_temp';
/** libpq `options` value every privileged session uses (SEC-P3-27 item 4, SEC-P3-34 item 2). */
export const PRIVILEGED_SESSION_OPTIONS = '-c search_path=pg_catalog,pg_temp';
export const LEDGER_TABLE = 'public.bootstrap_migrations';
/** Reserved variable, always `current_database()`. */
export const DB_NAME_VARIABLE = 'db_name';
/** Reserved variables holding the role-password verifiers (PR5-SEC-01). */
export const PASSWORD_VARIABLES = { migrator: 'migrator_password', app: 'app_password' } as const;
/** Session bounds (CLAUDE.md §9): connection attempt, wait for the lane's advisory lock, one file's statements. */
export const CONNECT_TIMEOUT_MS = 10_000;
export const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
export const FILE_STATEMENT_TIMEOUT = '5min';
/** `FILE_STATEMENT_TIMEOUT` in milliseconds: the longest a single bootstrap statement may run on the server. */
export const STATEMENT_TIMEOUT_MS = 300_000;
/** Client-side `query_timeout`: the server cancels at `STATEMENT_TIMEOUT_MS`; the client gives up 10 s later (R2-n2). */
export const QUERY_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + 10_000;
/** The variable every bootstrap connection URL comes from (reset.ts derives its maintenance URL from it). */
export const BOOTSTRAP_URL_VARIABLE = 'DATABASE_BOOTSTRAP_URL';
const FILE_NAME = /^\d{2}-[a-z0-9-]+\.sql$/;
/** Advisory-lock key: the first 8 bytes of SHA-256("platform:bootstrap-lane"), as a signed bigint. */
export const LOCK_KEY = createHash('sha256').update('platform:bootstrap-lane').digest().readBigInt64BE(0).toString();

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

/**
 * Cluster-admin connection settings. No `options` (the runner sets the search path) and no `ssl`: TLS comes from the
 * URL's selectors only, through the platform's one implementation (an object without `connectionString` is plain TCP).
 */
export type PrivilegedConnection = Omit<pg.ClientConfig, 'options' | 'ssl'>;

export interface BootstrapOptions {
  /** Cluster-admin connection. Must not carry its own `options`; the runner sets the search path. */
  connection: PrivilegedConnection;
  /** Role passwords from the secret manager; they reach the server only as SCRAM-SHA-256 verifiers. */
  passwords: RolePasswords;
  /** Further variable values. `db_name` and every `*_password` name are reserved. */
  vars?: Readonly<Record<string, string>>;
  dir?: string;
  log?: (line: string) => void;
  /** Longest wait for the bootstrap-lane advisory lock (default `DEFAULT_LOCK_TIMEOUT_MS`). */
  lockTimeoutMs?: number;
}

export interface RolePasswords {
  migrator: string;
  app: string;
}

/**
 * Variables for the bootstrap files, without `db_name`: the caller's values plus the SCRAM-SHA-256 verifiers of the
 * role passwords. Refuses reserved names, so no caller can pass a plaintext password as a variable. Messages never
 * contain a value.
 */
export function bootstrapVariables(options: Pick<BootstrapOptions, 'passwords' | 'vars'>): Record<string, string> {
  const vars = options.vars ?? {};
  for (const name of Object.keys(vars)) {
    if (name === DB_NAME_VARIABLE) throw new BootstrapError(`variable ${DB_NAME_VARIABLE} is reserved`);
    if (/_password$/i.test(name)) throw new BootstrapError(`variable ${name} is reserved: pass role passwords through "passwords"`);
  }
  const verifier = (role: keyof RolePasswords): string => {
    const password: unknown = (options.passwords as Partial<RolePasswords> | undefined)?.[role];
    if (typeof password !== 'string') throw new BootstrapError(`passwords.${role} is not set`);
    try {
      return scramSha256Verifier(password);
    } catch (error) {
      if (error instanceof ScramPasswordError) throw new BootstrapError(`passwords.${role}: ${error.message}`);
      throw error;
    }
  };
  return { ...vars, [PASSWORD_VARIABLES.migrator]: verifier('migrator'), [PASSWORD_VARIABLES.app]: verifier('app') };
}

/** Runs `sql` in one transaction whose statements are bounded by `FILE_STATEMENT_TIMEOUT`. */
async function inFileTransaction(client: pg.Client, sql: string, after?: () => Promise<unknown>): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SET LOCAL statement_timeout = '${FILE_STATEMENT_TIMEOUT}'`);
  await client.query(sql);
  if (after) await after();
  await client.query('COMMIT');
}

export interface BootstrapResult {
  database: string;
  applied: string[];
  skipped: string[];
}

export interface PrivilegedConnectionOptions {
  /** CA directories `sslrootcert` must lie in; a unit-test seam, production uses `DATABASE_CA_DIRECTORIES`. */
  readonly caDirectories?: readonly string[];
  /** Receives the value-free line of a connection-level `'error'` event (default: stderr). */
  readonly writeError?: (line: string) => void;
}

/**
 * The `pg.Client` config of a privileged session: explicit TLS from the URL's selectors (`ssl: false` for an object
 * without `connectionString`), the pinned search path, bounded connect and query time, TCP keep-alive. A TLS refusal
 * (`no-verify`, an unknown `sslmode`, an unusable `sslrootcert`, a parameter outside the TLS allow-list) is a
 * `BootstrapError` naming DATABASE_BOOTSTRAP_URL, never the value or a path.
 */
export function privilegedClientConfig(
  connection: PrivilegedConnection,
  caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES,
): pg.ClientConfig {
  const { connectionString, ...rest } = connection;
  if (typeof connectionString === 'string' && /[?&]options=/i.test(connectionString)) {
    throw new BootstrapError('the bootstrap connection string must not carry an options parameter');
  }
  let tls: Pick<pg.ClientConfig, 'connectionString' | 'ssl' | 'sslnegotiation'> = { ssl: false };
  if (connectionString !== undefined) {
    const url = URL.parse(connectionString);
    if (url === null) throw new BootstrapError(`${BOOTSTRAP_URL_VARIABLE}: connectionString is not a valid URL`);
    try {
      tls = databaseConnectionSettings(url, caDirectories);
    } catch (error) {
      // The message is fixed text without a value or a path (packages/config/src/db-tls.ts); no cause is kept.
      if (error instanceof DatabaseConfigError) throw new BootstrapError(`${BOOTSTRAP_URL_VARIABLE}: ${error.message}`);
      throw error;
    }
  }
  return {
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ...rest,
    ...tls,
    query_timeout: QUERY_TIMEOUT_MS,
    keepAlive: true,
    options: PRIVILEGED_SESSION_OPTIONS,
  };
}

/** One value-free line for a connection-level `'error'` event: the error class and an errno/SQLSTATE code only. */
export function connectionErrorLine(error: unknown): string {
  const name = error instanceof Error ? error.name : 'non-error';
  const code = (error as { code?: unknown } | null)?.code;
  const safeCode = typeof code === 'string' && /^(?:E[A-Z]{2,15}|[0-9A-Z]{5})$/.test(code) ? ` ${code}` : '';
  return `[bootstrap] connection error (${name}${safeCode})`;
}

/** Opens a privileged session pinned to `pg_catalog, pg_temp` and checks the effective path. */
export async function connectPrivileged(connection: PrivilegedConnection, options: PrivilegedConnectionOptions = {}): Promise<pg.Client> {
  const client = new pg.Client(privilegedClientConfig(connection, options.caDirectories));
  const writeError = options.writeError ?? ((line: string) => process.stderr.write(`${line}\n`));
  // Without a listener an idle-connection error would crash the process; a pending query still rejects (R2 m1).
  client.on('error', (error) => {
    writeError(connectionErrorLine(error));
  });
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
  const callerVars = bootstrapVariables(options);
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs <= 0) throw new BootstrapError('lockTimeoutMs must be a positive integer');
  const files = listBootstrapFiles(options.dir ?? DEFAULT_BOOTSTRAP_DIR);
  const client = await connectPrivileged(options.connection);
  try {
    const database = (await client.query<{ db: string }>('SELECT pg_catalog.current_database() AS db')).rows[0]?.db ?? '';
    const vars: Record<string, string> = { ...callerVars, [DB_NAME_VARIABLE]: database };
    // Fail fast on a missing variable before anything is applied.
    for (const file of files) {
      const missing = referencedVariables(file.sql).filter((name) => vars[name] === undefined);
      if (missing.length > 0) throw new BootstrapError(`${file.name} needs variable(s) ${missing.join(', ')}`);
    }

    // lock_timeout bounds the advisory-lock wait and, for the rest of the session, every lock the files wait for.
    await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
    try {
      await client.query('SELECT pg_catalog.pg_advisory_lock($1::bigint)', [LOCK_KEY]);
    } catch (error) {
      throw new BootstrapError(`bootstrap lane lock not acquired within ${lockTimeoutMs} ms (another runner holds it): ${describe(error)}`);
    }
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
        await inFileTransaction(client, sql, () =>
          client.query(`INSERT INTO ${LEDGER_TABLE} (file_name, sha256) VALUES ($1, $2)`, [file.name, file.sha256]),
        );
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
  const callerVars = bootstrapVariables(options);
  const client = await connectPrivileged(options.connection);
  try {
    const database = (await client.query<{ db: string }>('SELECT pg_catalog.current_database() AS db')).rows[0]?.db ?? '';
    const sql = substituteVariables(file.sql, { ...callerVars, [DB_NAME_VARIABLE]: database });
    try {
      await inFileTransaction(client, sql);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new BootstrapError(`${file.name} failed on ${database}: ${describe(error)}`);
    }
  } finally {
    await client.end();
  }
}

/** Compose/ECS secret mount; a `*_FILE` path must lie lexically under it (ADR-0018 am. 6, D-ARCH-052). */
export const SECRET_FILE_ROOT = '/run/secrets';
/** Largest secret file accepted (64 KiB), the `file` provider's bar (packages/config, PR3-SEC-07). */
export const SECRET_FILE_MAX_BYTES = 64 * 1024;
/**
 * The `FILE_PATH` rule of packages/config/src/secret-refs.ts (restated, not imported: the bootstrap tool's import
 * closure stays `pg` + `node:*`, D-ARCH-052): one to four plain segments under /run/secrets, no `.`/`..` segment.
 */
const SECRET_FILE_PATH = /^\/run\/secrets(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}){1,4}$/;

export interface ReadSecretOptions {
  /** Directory standing in for /run/secrets (tests); the `*_FILE` value is still checked against /run/secrets. */
  readonly root?: string;
}

const isWithin = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};

/** Reads a confined secret file; every error names `variable` only, never the path or the content. */
function readSecretFile(variable: string, locator: string, root: string): string {
  const refuse = (reason: string): never => {
    throw new BootstrapError(`${variable}: ${reason}`);
  };
  if (!SECRET_FILE_PATH.test(locator)) refuse(`must name a file under ${SECRET_FILE_ROOT}`);
  let content: Buffer;
  try {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(join(root, ...locator.slice(SECRET_FILE_ROOT.length + 1).split('/')));
    if (!isWithin(realRoot, realTarget)) refuse(`resolves outside ${SECRET_FILE_ROOT}`);
    const info = statSync(realTarget);
    if (!info.isFile()) refuse('is not a regular file');
    if (info.size > SECRET_FILE_MAX_BYTES) refuse(`exceeds ${SECRET_FILE_MAX_BYTES} bytes`);
    content = readFileSync(realTarget);
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    return refuse(`could not be read (${typeof code === 'string' && /^E[A-Z]{2,15}$/.test(code) ? code : 'EIO'})`);
  }
  if (content.byteLength > SECRET_FILE_MAX_BYTES) refuse(`exceeds ${SECRET_FILE_MAX_BYTES} bytes`);
  return content.toString('utf8').replace(/\r?\n$/, '');
}

/**
 * Secret from `NAME` or from the file named by `NAME_FILE` (Compose secrets); never logged. Hardened to the `file`
 * provider's bar (ADR-0018 am. 6, D-ARCH-052): exactly one of the two may be set; the file lies lexically under
 * /run/secrets and its real path stays there (a symlink leaving the root is refused); regular file, at most 64 KiB;
 * one trailing newline stripped; an empty value or file counts as unset. Errors name the variable only.
 */
export function readSecret(env: NodeJS.ProcessEnv, name: string, options: ReadSecretOptions = {}): string {
  const fileVariable = `${name}_FILE`;
  const direct = env[name] ?? '';
  const locator = env[fileVariable] ?? '';
  if (direct !== '' && locator !== '') throw new BootstrapError(`set ${name} or ${fileVariable}, not both`);
  if (direct !== '') return direct;
  const fromFile = locator === '' ? '' : readSecretFile(fileVariable, locator, options.root ?? SECRET_FILE_ROOT);
  if (fromFile === '') throw new BootstrapError(`${name} (or ${fileVariable}) is not set`);
  return fromFile;
}

/** Role passwords from BOOTSTRAP_MIGRATOR_PASSWORD / BOOTSTRAP_APP_PASSWORD (or their `*_FILE` variants). */
export function readRolePasswords(env: NodeJS.ProcessEnv): RolePasswords {
  return { migrator: readSecret(env, 'BOOTSTRAP_MIGRATOR_PASSWORD'), app: readSecret(env, 'BOOTSTRAP_APP_PASSWORD') };
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  try {
    const connectionString = env[BOOTSTRAP_URL_VARIABLE];
    if (connectionString === undefined || connectionString === '') throw new BootstrapError(`${BOOTSTRAP_URL_VARIABLE} is not set`);
    // PR3-SEC-14: staging/production need verify-full, no placeholder and NODE_TLS_REJECT_UNAUTHORIZED unset or 1.
    const issues = checkToolingEnv(env, BOOTSTRAP_URL_VARIABLE);
    if (issues.length > 0) throw new BootstrapError(`environment refused: ${formatToolingIssues(issues)}`);
    const result = await runBootstrap({
      connection: { connectionString },
      passwords: readRolePasswords(env),
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
