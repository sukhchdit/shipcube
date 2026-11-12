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
 * `pg` the URL without its query string plus an explicit `ssl` value with `rejectUnauthorized: true` pinned.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { RUNTIME_DATABASE_URL_PARAMS } from '@platform/config';
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

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 25_000;
const MAX_STATEMENT_TIMEOUT_MS = 300_000;
/** Client-side `query_timeout` margin above `statement_timeout`: the server cancels first; the client gives up next. */
export const QUERY_TIMEOUT_MARGIN_MS = 1_000;

/**
 * Query parameters a runtime URL may carry (PR5-SEC-08): only the TLS selectors, from the one list in
 * @platform/config (`RUNTIME_DATABASE_URL_PARAMS`; configuration validation applies it in every APP_ENV, PR-0009
 * R2-m2). pg copies every query entry over the explicit pool settings, so any other one (`options`, `lock_timeout`,
 * `idle_in_transaction_session_timeout`, `application_name`, `connect_timeout`, `host`, `ssl`, ...) would silently
 * override the role settings or the values below. Names are compared after percent-decoding, as pg reads them, so
 * `%6Fptions` is `options`. Since PR9-SEC-04 pg never sees the query string at all (`tlsConfig` translates the TLS
 * selectors); the allow-list still fails fast on anything else rather than silently dropping it.
 */
function assertAllowedParams(params: URLSearchParams): void {
  const names = [...params.keys()];
  if (new Set(names).size !== names.length) throw new DatabaseConfigError('connectionString must not repeat a query parameter');
  // The offending name is not echoed: the URL is a secret-bearing value.
  if (names.some((name) => !RUNTIME_DATABASE_URL_PARAMS.has(name))) {
    throw new DatabaseConfigError('connectionString carries a query parameter outside the TLS allow-list');
  }
}

/** `sslmode` values that select TLS; every one of them is verified as libpq `verify-full` (see `tlsConfig`). */
const TLS_SSLMODES: ReadonlySet<string> = new Set(['allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

/** The TLS part of the pool settings, derived from the allow-listed URL parameters only. */
type TlsPoolConfig = Pick<PoolConfig, 'ssl' | 'sslnegotiation'>;
type SslNegotiation = NonNullable<PoolConfig['sslnegotiation']>;

function isSslNegotiation(value: string): value is SslNegotiation {
  return value === 'postgres' || value === 'direct';
}

/** A CA bundle is small (the RDS global bundle is about 160 kB); the cap keeps a wrong path from exhausting memory. */
const MAX_ROOT_CERTIFICATE_BYTES = 1_048_576;

/**
 * PR9-SEC-16: an absolute path to a regular file of at most 1 MiB, checked before reading so that a FIFO or a device
 * cannot block start-up. libpq's `system` keyword (the OS trust store) is refused: pinning means a named CA bundle.
 */
function readRootCertificate(path: string): string {
  if (path === 'system') throw new DatabaseConfigError('connectionString sslrootcert must name a CA bundle file');
  if (!isAbsolute(path)) throw new DatabaseConfigError('connectionString sslrootcert must be an absolute path');
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_ROOT_CERTIFICATE_BYTES) {
      throw new DatabaseConfigError('connectionString sslrootcert must be a regular file of at most 1 MiB');
    }
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof DatabaseConfigError) throw error;
    // Neither the path nor the fs error (which names the path) is echoed.
    throw new DatabaseConfigError('connectionString sslrootcert could not be read');
  }
}

/**
 * Explicit `pg` TLS settings for the URL's TLS selectors (PR9-SEC-04). Values are percent-decoded, as pg reads them.
 *
 * - no `sslmode` (and neither `sslrootcert` nor `sslnegotiation=direct`), or `sslmode=disable` → `ssl: false`, set
 *   explicitly so that `PGSSLMODE` cannot switch on an unverified connection;
 * - `sslmode=no-verify` → refused;
 * - `allow`, `prefer`, `require`, `verify-ca`, `verify-full` (or no `sslmode` with `sslrootcert` or
 *   `sslnegotiation=direct`, which pg also reads as TLS) → `rejectUnauthorized: true` with Node's default host-name
 *   check, i.e. libpq `verify-full`; `sslrootcert` is read into `ca`; `sslnegotiation` is passed through.
 *
 * pg's `uselibpqcompat` (weaker libpq semantics for `prefer`, `require` and `verify-ca`) is not an allowed parameter:
 * pg no longer parses the TLS selectors itself, so it could have no effect (PR-0009 R2-m2).
 */
function tlsConfig(params: URLSearchParams): TlsPoolConfig {
  const sslmode = params.get('sslmode');
  const sslnegotiation = params.get('sslnegotiation');
  const sslrootcert = params.get('sslrootcert');
  if (sslmode === 'no-verify') throw new DatabaseConfigError('connectionString must not disable certificate verification');
  if (sslmode !== null && sslmode !== 'disable' && !TLS_SSLMODES.has(sslmode)) {
    throw new DatabaseConfigError('connectionString sslmode is not a supported value');
  }
  if (sslnegotiation !== null && !isSslNegotiation(sslnegotiation)) {
    throw new DatabaseConfigError('connectionString sslnegotiation must be postgres or direct');
  }
  const negotiation = sslnegotiation === null ? {} : { sslnegotiation };
  const tls = sslmode === null ? sslnegotiation === 'direct' || sslrootcert !== null : sslmode !== 'disable';
  if (!tls) {
    if (sslnegotiation === 'direct') throw new DatabaseConfigError('connectionString sslnegotiation=direct requires TLS');
    return { ssl: false, ...negotiation };
  }
  return {
    ssl: { rejectUnauthorized: true, ...(sslrootcert === null ? {} : { ca: readRootCertificate(sslrootcert) }) },
    ...negotiation,
  };
}

/** The URL without its query string and fragment: what pg may parse (host, port, user, password, database only). */
function withoutQuery(url: URL): string {
  const bare = new URL(url.href);
  bare.search = '';
  bare.hash = '';
  return bare.href;
}

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
 */
export function toPoolConfig(options: DatabaseClientOptions): PoolConfig {
  let url: URL;
  try {
    url = new URL(options.connectionString);
  } catch {
    throw new DatabaseConfigError('connectionString is not a valid URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError(`connectionString must use postgres:// or postgresql://, got ${url.protocol}`);
  }
  // The runtime role's search path and timeouts are role settings (data-model §4.4); a URL must not override them.
  assertAllowedParams(url.searchParams);
  const tls = tlsConfig(url.searchParams);
  if (!APPLICATION_NAME.test(options.applicationName)) {
    throw new DatabaseConfigError('applicationName must be 1-63 lowercase letters, digits or dashes, starting with a letter');
  }
  const statementTimeoutMs = positiveInteger(
    'statementTimeoutMs',
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    MAX_STATEMENT_TIMEOUT_MS,
  );
  return {
    connectionString: withoutQuery(url),
    ...tls,
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
