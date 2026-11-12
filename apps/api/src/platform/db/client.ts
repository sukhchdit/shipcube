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
 */
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';

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
}

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

const DEFAULT_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const APPLICATION_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function positiveInteger(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new DatabaseConfigError(`${name} must be an integer between 1 and ${max}, got ${String(value)}`);
  }
  return value;
}

/** Validated `pg` pool settings for the runtime role. Throws `DatabaseConfigError` on a bad value (fail fast). */
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
  if (url.searchParams.has('options')) throw new DatabaseConfigError('connectionString must not carry an options parameter');
  if (!APPLICATION_NAME.test(options.applicationName)) {
    throw new DatabaseConfigError('applicationName must be 1-63 lowercase letters, digits or dashes, starting with a letter');
  }
  return {
    connectionString: options.connectionString,
    max: positiveInteger('poolMax', options.poolMax, APP_ROLE_CONNECTION_LIMIT),
    idleTimeoutMillis: positiveInteger('idleTimeoutMs', options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, 3_600_000),
    connectionTimeoutMillis: positiveInteger('connectionTimeoutMs', options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, 120_000),
    application_name: options.applicationName,
  };
}

/** The Prisma driver adapter for the runtime role. */
export function createDatabaseAdapter(options: DatabaseClientOptions): PrismaPg {
  return new PrismaPg(toPoolConfig(options));
}

/** Constructor shape of a generated Prisma 7 client (`new PrismaClient({ adapter })`). */
export type PrismaClientConstructor<TClient> = new (options: { adapter: PrismaPg }) => TClient;

/** Builds the runtime Prisma client: `createDatabaseClient(PrismaClient, config.db)`. */
export function createDatabaseClient<TClient>(Client: PrismaClientConstructor<TClient>, options: DatabaseClientOptions): TClient {
  return new Client({ adapter: createDatabaseAdapter(options) });
}
