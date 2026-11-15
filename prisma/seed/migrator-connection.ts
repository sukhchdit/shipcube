/**
 * The seed CLI's privileged `platform_migrator` connection (TASK-023; SEC-P3-34 item 2, PR13-SEC-01/-03, code review
 * PR #13 m1-m3). Everything here runs before the first seed statement:
 * - the URL comes from `DATABASE_MIGRATOR_URL` only (a direct value, ADR-0018 am. 6); `*_FILE` variants are refused;
 * - the URL's query parameters must come from the platform's single `DATABASE_URL` allow-list
 *   (`RUNTIME_DATABASE_URL_PARAMS`), because node-postgres lets URL query parameters (`options=`, `statement_timeout=`,
 *   `host=`) override the pinned session;
 * - the environment passes `checkToolingEnv` (PR3-SEC-14): staging/production need exactly one `sslmode=verify-full`,
 *   no placeholder and `NODE_TLS_REJECT_UNAUTHORIZED` unset or `1`;
 * - TLS is the platform's one implementation (`databaseConnectionSettings`, PR13-SEC-09): pg gets the URL without its
 *   query plus an explicit `ssl`, so neither the URL, `PGSSLMODE` nor `NODE_TLS_REJECT_UNAUTHORIZED` decides it;
 * - after connecting, the session's `search_path` and timeouts are read back and must equal the pin;
 * - a connection lost mid-run surfaces as the failing query's rejection (exit 2), never as an unhandled `'error'`
 *   event that would crash the process with exit 1 (the refusal code); the listener writes one value-free line.
 * Errors and refusals name variables only, never a value or a file path.
 */
import { types } from 'node:util';

import {
  checkToolingEnv,
  DATABASE_CA_DIRECTORIES,
  databaseConnectionSettings,
  DatabaseConfigError,
  type DatabaseConnectionSettings,
  hasOnlyRuntimeDatabaseUrlParams,
} from '@platform/config';
import pg from 'pg';

import { SEED_PASSWORD_VARIABLES, SeedRefusedError, type SeedSql } from './framework/contracts.js';

export const MIGRATOR_URL_VARIABLE = 'DATABASE_MIGRATOR_URL';

export const CONNECT_TIMEOUT_MS = 10_000;
export const STATEMENT_TIMEOUT_MS = 120_000;
/** Client-side `query_timeout`: the server cancels at `statement_timeout`; the client gives up 10 s later (R2-n2). */
export const QUERY_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + 10_000;
/** The migrator session is privileged: pin the search path like tools/db/bootstrap.ts (SEC-P3-34 item 2). */
export const PINNED_SEARCH_PATH = 'pg_catalog, pg_temp';
const SESSION_OPTIONS = `-c search_path=${PINNED_SEARCH_PATH.replaceAll(' ', '')}`;

/**
 * Every variable the seed CLI reads. None has a `_FILE` variant: ADR-0018 am. 6 admits `<NAME>_FILE` only for the two
 * bootstrap passwords (holder `bootstrap`), so a set `<NAME>_FILE` here is a misconfiguration and is refused instead of
 * being silently ignored (PR13-SEC-01, D-ORCH-016 item 2).
 */
export const SEED_READ_VARIABLES: readonly string[] = Object.freeze([
  'APP_ENV',
  'NODE_ENV',
  MIGRATOR_URL_VARIABLE,
  ...SEED_PASSWORD_VARIABLES,
]);

/** Refuses any present, non-empty `<NAME>_FILE` for a variable the seed reads (names only; no file is opened). */
export function refuseFileVariants(env: Readonly<Record<string, string | undefined>>): void {
  const present = SEED_READ_VARIABLES.map((name) => `${name}_FILE`).filter((name) => (env[name] ?? '') !== '');
  if (present.length > 0) {
    throw new SeedRefusedError(
      'SEED_ENVIRONMENT_INVALID',
      present,
      `Seed refused: ${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} not supported (ADR-0018 am. 6); set the variable itself.`,
    );
  }
}

const POSTGRES_PROTOCOLS: readonly string[] = ['postgres:', 'postgresql:'];

/**
 * A TCP host and only the TLS selectors of `RUNTIME_DATABASE_URL_PARAMS` (`sslmode`, `sslrootcert`,
 * `sslnegotiation`), each at most once: the same rule the runtime pool and `databaseUrlParamsGuard` apply to
 * `DATABASE_URL`. pg decodes the host, so a percent-encoded `/` would make a Unix-socket path: refused like an empty
 * host.
 */
function isAllowListedMigratorUrl(url: URL): boolean {
  return url.hostname !== '' && !url.hostname.includes('%') && hasOnlyRuntimeDatabaseUrlParams(url);
}

function refuseUrl(problem: string, subjects: readonly string[] = [MIGRATOR_URL_VARIABLE]): SeedRefusedError {
  return new SeedRefusedError('SEED_ENVIRONMENT_INVALID', subjects, `Seed refused: ${MIGRATOR_URL_VARIABLE} ${problem}.`);
}

/**
 * Reads and checks `DATABASE_MIGRATOR_URL`: present, a `postgres[ql]://` URL with a TCP host, and only allow-listed
 * query parameters (no `options`, `statement_timeout`, `idle_in_transaction_session_timeout`, `host`, `hostaddr`,
 * `search_path`, `ssl`, `application_name`, `connect_timeout`, …); then `checkToolingEnv` (PR3-SEC-14), whose issue
 * keys become the refusal's subjects (`DATABASE_MIGRATOR_URL`, `APP_ENV`, `NODE_TLS_REJECT_UNAUTHORIZED`). Returns the
 * URL and the values the CLI must redact from any driver error.
 */
export function readMigratorUrl(env: Readonly<Record<string, string | undefined>>): {
  readonly url: string;
  readonly secrets: readonly string[];
} {
  const url = env[MIGRATOR_URL_VARIABLE] ?? '';
  if (url === '')
    throw new SeedRefusedError('SEED_VARIABLE_MISSING', [MIGRATOR_URL_VARIABLE], `Seed refused: ${MIGRATOR_URL_VARIABLE} is not set.`);
  const parsed = URL.parse(url);
  if (parsed === null || !POSTGRES_PROTOCOLS.includes(parsed.protocol)) throw refuseUrl('must be a postgresql:// URL');
  if (!isAllowListedMigratorUrl(parsed)) {
    throw refuseUrl('must name a TCP host and carry no session-overriding or repeated query parameter');
  }
  const issues = checkToolingEnv(env, MIGRATOR_URL_VARIABLE);
  if (issues.length > 0) {
    throw refuseUrl('or its environment is not acceptable for this APP_ENV (PR3-SEC-14)', [...new Set(issues.map((issue) => issue.key))]);
  }
  return { url, secrets: [url, ...passwordForms(parsed.password)] };
}

/**
 * The URL without its query plus the explicit TLS settings (PR13-SEC-09), before anything connects. A TLS refusal
 * (`no-verify`, an unknown `sslmode`, an unusable `sslrootcert`) becomes an exit-1 refusal naming the variable.
 */
export function migratorConnectionSettings(
  connectionString: string,
  caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES,
): DatabaseConnectionSettings {
  const url = URL.parse(connectionString);
  if (url === null) throw refuseUrl('must be a postgresql:// URL');
  try {
    return databaseConnectionSettings(url, caDirectories);
  } catch (error) {
    // The message is fixed text without a value or a path (packages/config/src/db-tls.ts).
    if (error instanceof DatabaseConfigError) throw refuseUrl(error.message.replace(/^connectionString /, ''));
    throw error;
  }
}

/** One value-free JSON line for a connection-level `'error'` event: the error class and an errno/SQLSTATE code only. */
export function connectionErrorLine(error: unknown): string {
  const name = types.isNativeError(error) ? error.name : 'non-error';
  const code = (error as { code?: unknown } | null)?.code;
  const safeCode = typeof code === 'string' && /^(?:E[A-Z]{2,15}|[0-9A-Z]{5})$/.test(code) ? { code } : {};
  return JSON.stringify({ level: 'error', event: 'seed.connection_error', error: name, ...safeCode });
}

/** The URL's password as written and as the driver decodes it, so neither form can be echoed (PR13-SEC-07). */
function passwordForms(password: string): string[] {
  if (password === '') return [];
  try {
    return [password, decodeURIComponent(password)];
  } catch {
    // A malformed escape: the driver cannot decode it either, so only the raw form can appear in an error.
    return [password];
  }
}

/** The minimal `pg.Client` surface the connection needs; injectable so the pin check is unit-testable. */
export interface MigratorClient extends SeedSql {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export type MigratorClientFactory = (config: pg.ClientConfig) => MigratorClient;

const pgClientFactory: MigratorClientFactory = (config) => new pg.Client(config);

interface SettingRow extends Record<string, unknown> {
  readonly name: string;
  readonly setting: string;
}

const EXPECTED_SETTINGS: Readonly<Record<string, string>> = {
  search_path: PINNED_SEARCH_PATH,
  statement_timeout: String(STATEMENT_TIMEOUT_MS),
  idle_in_transaction_session_timeout: String(STATEMENT_TIMEOUT_MS),
};

/**
 * Reads the session settings back (`pg_settings.setting` is in the parameter's base unit, ms for the timeouts) and
 * refuses the run unless they equal the pin, as `tools/db/bootstrap.ts` does for `search_path` (SEC-P3-34 item 2).
 * This also catches a proxy that drops the startup `options`. The read-back is the only statement that runs before the
 * pin is verified, so its operator is schema-qualified too (PR13-SEC-10).
 */
async function assertPinnedSession(sql: SeedSql): Promise<void> {
  const { rows } = await sql.query<SettingRow>(
    'SELECT name, setting FROM pg_catalog.pg_settings WHERE name OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[])',
    [Object.keys(EXPECTED_SETTINGS)],
  );
  const actual = new Map(rows.map((row) => [row.name, row.setting.replace(/\s+/g, '')]));
  const drifted = Object.entries(EXPECTED_SETTINGS)
    .filter(([name, expected]) => actual.get(name) !== expected.replace(/\s+/g, ''))
    .map(([name]) => name);
  if (drifted.length > 0) {
    throw new SeedRefusedError(
      'SEED_ENVIRONMENT_INVALID',
      [MIGRATOR_URL_VARIABLE],
      `Seed refused: the migrator session is not pinned (${drifted.join(', ')}); check ${MIGRATOR_URL_VARIABLE} and the role settings.`,
    );
  }
}

export interface MigratorConnectionOptions {
  /** `pg.Client` stand-in (unit tests). */
  readonly createClient?: MigratorClientFactory;
  /** CA directories `sslrootcert` must lie in; a unit-test seam, production uses `DATABASE_CA_DIRECTORIES`. */
  readonly caDirectories?: readonly string[];
  /** Receives the value-free line of a connection-level `'error'` event (default: stderr). */
  readonly writeError?: (line: string) => void;
}

const writeStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** The pinned `pg.Client` config: explicit TLS, bounded connect/statement/query time, TCP keep-alive (R2-n2/-n3). */
export function migratorClientConfig(
  connectionString: string,
  caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES,
): pg.ClientConfig {
  return {
    ...migratorConnectionSettings(connectionString, caDirectories),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    keepAlive: true,
    application_name: 'platform-seed',
    options: SESSION_OPTIONS,
  };
}

/**
 * Runs `run` on one dedicated, pinned `platform_migrator` connection and always closes it. The `'error'` listener
 * writes one value-free line and otherwise only absorbs the event: node-postgres also rejects the pending query with
 * the same error, and that rejection is what reaches the CLI's `seed.failed` path (exit 2).
 */
export async function withMigratorConnection<T>(
  connectionString: string,
  run: (sql: SeedSql) => Promise<T>,
  options: MigratorConnectionOptions = {},
): Promise<T> {
  const { createClient = pgClientFactory, caDirectories = DATABASE_CA_DIRECTORIES, writeError = writeStderr } = options;
  const client = createClient(migratorClientConfig(connectionString, caDirectories));
  client.on('error', (error) => {
    writeError(connectionErrorLine(error));
  });
  await client.connect();
  try {
    await assertPinnedSession(client);
    return await run(client);
  } finally {
    // After a lost connection `end()` may reject too; the run's own error is the one worth reporting.
    await client.end().catch(() => undefined);
  }
}
