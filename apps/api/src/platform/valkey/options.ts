/**
 * ioredis options for Valkey, built from the validated `REDIS_URL` (ADR-0013, NFR-SEC-007; PR3-SEC-02/-12 consumer
 * half). The URL string is never handed to ioredis: ioredis 6 decides TLS from the raw `rediss://` prefix and
 * merges query parameters into its options (`?tls=` would select plain TCP). This builder parses the URL once with
 * WHATWG rules and sets every option explicitly, `tls` included, with SNI, a TLS 1.2 floor and pinned certificate
 * verification for `rediss:`.
 *
 * Every connection is bounded (CLAUDE.md §9): a connect timeout, a command timeout, one retry per request and a
 * capped exponential reconnect delay with jitter. Errors never echo the URL (it carries the ACL password).
 */
import { isIP } from 'node:net';

/**
 * TLS settings for `rediss:`: a TLS 1.2 floor, SNI for DNS names and certificate verification pinned on, so a stray
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot turn it off (PR9-SEC-04; Node's default reads that variable).
 */
export interface ValkeyTlsOptions {
  readonly servername?: string;
  readonly minVersion: 'TLSv1.2';
  readonly rejectUnauthorized: true;
}

/** The explicit ioredis options this platform uses (a subset of ioredis `RedisOptions`). */
export interface ValkeyConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly connectionName: string;
  readonly connectTimeout: number;
  readonly commandTimeout: number;
  readonly maxRetriesPerRequest: number;
  readonly retryStrategy: (times: number) => number;
  readonly username?: string;
  readonly password?: string;
  readonly tls?: ValkeyTlsOptions;
}

export class ValkeyConfigError extends Error {
  override readonly name = 'ValkeyConfigError';
}

export const VALKEY_DEFAULTS = Object.freeze({
  connectTimeoutMs: 5_000,
  /** Matches the 2 s readiness budget per dependency (US-012). */
  commandTimeoutMs: 2_000,
  maxRetriesPerRequest: 1,
  /** Reconnect delay: base · 2^(attempt-1), capped, with equal jitter (half fixed, half random). */
  reconnectBaseMs: 100,
  reconnectCapMs: 5_000,
});

export interface ValkeyOptionsInput {
  /** `redis://` or `rediss://` URL (the revealed `REDIS_URL`). */
  readonly url: string;
  /** `CLIENT SETNAME` label, e.g. `api`, `worker`. */
  readonly connectionName: string;
  readonly connectTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly maxRetriesPerRequest?: number;
  /** Uniform random number in [0, 1) for the reconnect jitter (test seam). */
  readonly random?: () => number;
}

const CONNECTION_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const DB_PATH = /^\/?(\d{1,2})?$/;

/** Reconnect delay for attempt `times` (1-based): capped exponential backoff with equal jitter. Never gives up. */
export function reconnectDelayMs(times: number, random: () => number = Math.random): number {
  const { reconnectBaseMs, reconnectCapMs } = VALKEY_DEFAULTS;
  const exponential = Math.min(reconnectCapMs, reconnectBaseMs * 2 ** Math.min(Math.max(times, 1) - 1, 16));
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

function parse(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new ValkeyConfigError('REDIS_URL is not a valid URL');
  }
}

function bounded(name: string, value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new ValkeyConfigError(`${name} must be an integer between 1 and ${max}`);
  return value;
}

/** Validated ioredis options; throws `ValkeyConfigError` (no URL content in the message) on a bad input. */
export function buildValkeyOptions(input: ValkeyOptionsInput): ValkeyConnectionOptions {
  const url = parse(input.url);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') throw new ValkeyConfigError('REDIS_URL must use redis:// or rediss://');
  if (url.hostname === '') throw new ValkeyConfigError('REDIS_URL must name a host');
  if (url.search !== '' || url.hash !== '') throw new ValkeyConfigError('REDIS_URL must not carry a query string or fragment');
  const db = DB_PATH.exec(url.pathname);
  if (db === null) throw new ValkeyConfigError('REDIS_URL path must be empty or a database number');
  if (!CONNECTION_NAME.test(input.connectionName))
    throw new ValkeyConfigError('connectionName must be lowercase letters, digits or dashes');
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const random = input.random ?? Math.random;
  // SNI needs a DNS name; for an IP literal Node verifies the certificate's IP SAN against the host instead.
  const tls: ValkeyTlsOptions =
    isIP(host) === 0
      ? { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true }
      : { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  return {
    host,
    port: url.port === '' ? 6379 : Number(url.port),
    db: db[1] === undefined ? 0 : Number(db[1]),
    connectionName: input.connectionName,
    connectTimeout: bounded('connectTimeoutMs', input.connectTimeoutMs ?? VALKEY_DEFAULTS.connectTimeoutMs, 60_000),
    commandTimeout: bounded('commandTimeoutMs', input.commandTimeoutMs ?? VALKEY_DEFAULTS.commandTimeoutMs, 60_000),
    maxRetriesPerRequest: input.maxRetriesPerRequest ?? VALKEY_DEFAULTS.maxRetriesPerRequest,
    retryStrategy: (times: number) => reconnectDelayMs(times, random),
    ...(url.username === '' ? {} : { username: decodeURIComponent(url.username) }),
    ...(url.password === '' ? {} : { password: decodeURIComponent(url.password) }),
    ...(url.protocol === 'rediss:' ? { tls } : {}),
  };
}
