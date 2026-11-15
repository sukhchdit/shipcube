/**
 * Runtime database client factory (data-model.md §7.1, ADR-0005; TASK-003).
 *
 * The API and the worker connect as `platform_app` only (REQ-RLS-005): this factory takes the runtime connection
 * string from typed configuration and never sees the migrator or bootstrap URLs. Prisma 7 runs engine-free through
 * the `pg` driver adapter, so the `pg` pool settings below replace Prisma 6's connection-pool defaults.
 *
 * The options are a plain typed object: `packages/config` (TASK-005) maps the validated environment onto it, and the
 * composition root (TASK-006) passes the generated `PrismaClient` class in, which keeps this module independent of
 * the generated client's location (data-model §7.2).
 *
 * TLS is decided here, never by `pg` (PR9-SEC-04): `pg` lets URL-derived TLS settings replace an explicit `ssl`
 * object, reads `PGSSLMODE` when `ssl` is unset (`no-verify` turns verification off) and otherwise leaves
 * `rejectUnauthorized` to Node's default, which `NODE_TLS_REJECT_UNAUTHORIZED=0` flips. `toPoolConfig` therefore hands
 * `pg` the URL without its query string plus an explicit `ssl` value with `rejectUnauthorized: true` pinned. The
 * translation is the platform's one implementation in @platform/config (`databaseConnectionSettings`, TASK-014), shared
 * with the seed and bootstrap connections; the worker builds its pool through this module.
 */
import { DATABASE_CA_DIRECTORIES, databaseConnectionSettings, DatabaseConfigError } from '@platform/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { type PoolConfig } from 'pg';

/** `platform_app` connection limit (data-model.md §4.4); tasks × poolMax must stay below it. */
export const APP_ROLE_CONNECTION_LIMIT = 200;

export interface DatabaseClientOptions {
  /** `postgres://` / `postgresql://` URL of the runtime role `platform_app`. */
  readonly connectionString: string;
  /** Pool size per process: start with 10 per API task and 5 per worker task (data-model §7.1). */
  readonly poolMax: number;
  /** Shown in `pg_stat_activity` (service name, e.g. `api`, `worker`). */
  readonly applicationName: string;
  /** Idle connections are closed after this many milliseconds. Default 10 000. */
  readonly idleTimeoutMs?: number;
  /** Fails a checkout that cannot connect within this many milliseconds. Default 5 000. */
  readonly connectionTimeoutMs?: number;
  /**
   * Server-side `statement_timeout` of every pooled connection (`DB_STATEMENT_TIMEOUT_MS`, PR-0005 code review m7).
   * Pool-level backstop, default 25 000 ms; the role backstop (TASK-016, 30 s) applies only to sessions outside the
   * pool, because this startup parameter overrides a role default on every pooled connection; request transactions
   * set a tighter one (data-model §4.1).
   */
  readonly statementTimeoutMs?: number;
}

/** Moved to @platform/config (TASK-014 T-01); re-exported so `config-exit.ts` and existing callers keep one class. */
export { DatabaseConfigError };

const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 25_000;
const MAX_STATEMENT_TIMEOUT_MS = 300_000;
/** Client-side `query_timeout` margin above `statement_timeout`: the server cancels first; the client gives up next. */
export const QUERY_TIMEOUT_MARGIN_MS = 1_000;

const APPLICATION_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function positiveInteger(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new DatabaseConfigError(`${name} must be an integer between 1 and ${max}, got ${String(value)}`);
  }
  return value;
}

/**
 * Validated `pg` pool settings for the runtime role. Throws `DatabaseConfigError` on a bad value (fail fast).
 *
 * `connectionString` is the input URL without its query string; the TLS selectors it carried come back as the
 * explicit `ssl` (and `sslnegotiation`) settings, which neither the URL nor `PGSSLMODE` can then override.
 * `caDirectories` is a unit-test seam for the `sslrootcert` confinement (PR9-SEC-17); production uses the default.
 */
export function toPoolConfig(options: DatabaseClientOptions, caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES): PoolConfig {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch {
    throw new DatabaseConfigError('connectionString is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(`connectionString must use postgres:// or postgresql://, got ${url.protocol}`);
  }
  // The runtime role's search path and timeouts are role settings (data-model §4.4); a URL must not override them:
  // only the TLS selectors pass (PR5-SEC-08), and they come back as explicit settings.
  const connection = databaseConnectionSettings(url, caDirectories);
  if (!APPLICATION_NAME.test(options.applicationName)) {
    throw new DatabaseConfigError('applicationName must be 1-63 lowercase letters, digits or dashes, starting with a letter');
  }
  const statementTimeoutMs = positiveInteger(
    'statementTimeoutMs',
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    MAX_STATEMENT_TIMEOUT_MS,
  );
  return {
    ...connection,
    max: positiveInteger('poolMax', options.poolMax, APP_ROLE_CONNECTION_LIMIT),
    idleTimeoutMillis: positiveInteger('idleTimeoutMs', options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, 3_600_000),
    connectionTimeoutMillis: positiveInteger('connectionTimeoutMs', options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, 120_000),
    application_name: options.applicationName,
    statement_timeout: statementTimeoutMs,
    query_timeout: statementTimeoutMs + QUERY_TIMEOUT_MARGIN_MS,
  };
}

/**
 * The runtime `pg` pool (no connection is opened until first use). The composition root shares one pool between
 * the Prisma adapter and the readiness check, and ends it on shutdown.
 */
export function createDatabasePool(options: DatabaseClientOptions): pg.Pool {
  return new pg.Pool(toPoolConfig(options));
}

/** The Prisma driver adapter for the runtime role, over validated options or an existing runtime pool. */
export function createDatabaseAdapter(source: DatabaseClientOptions | pg.Pool): PrismaPg {
  return new PrismaPg(source instanceof pg.Pool ? source : toPoolConfig(source));
}

/**
 * Constructor shape of a generated Prisma 7 client (`new PrismaClient({ adapter, errorFormat })`). `errorFormat` is
 * always `minimal` (PR7-SEC-03 item 4): error messages then carry no query excerpt or input values.
 */
export type PrismaClientConstructor<TClient> = new (options: { adapter: PrismaPg; errorFormat: 'minimal' }) => TClient;

/** Builds the runtime Prisma client: `createDatabaseClient(PrismaClient, config.db)`. */
export function createDatabaseClient<TClient>(Client: PrismaClientConstructor<TClient>, options: DatabaseClientOptions): TClient {
  return new Client({ adapter: createDatabaseAdapter(options), errorFormat: 'minimal' });
}
