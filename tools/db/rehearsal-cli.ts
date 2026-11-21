/**
 * Shared command-line pieces of the rehearsal tools (`db:backup`, `db:verify-restore`, `db:zero-downtime-probe`;
 * TASK-034): flag parsing, the local-only database URL rule of `db:reset` (nothing runs against a shared environment,
 * CLAUDE.md §5) and the git-ignored artefact folder `reports/rehearsal/`. Messages name variables, never values.
 */
import { join } from 'node:path';

import type pg from 'pg';

import { REPO_ROOT } from './lint-migrations.js';
import { checkDatabaseName } from './pg-archive.js';
import { RehearsalError, type SqlSession } from './rehearsal-manifest.js';
import { effectiveEndpoint, isLocal, type Endpoint } from './reset.js';

export interface FlagSpec {
  /** Flags that take a value (`--name value` or `--name=value`). */
  readonly values: readonly string[];
  /** Flags without a value. */
  readonly switches: readonly string[];
}

export interface ParsedFlags {
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

/** Parses `argv` against `spec`; an unknown flag, a positional argument, a repeated or a missing value is refused. */
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(argument);
    if (match === null) throw new RehearsalError(`unexpected argument at position ${String(index + 1)} (flags only)`);
    const name = match[1] as string;
    if (spec.switches.includes(name) && match[2] === undefined) {
      switches.add(name);
      continue;
    }
    if (!spec.values.includes(name)) throw new RehearsalError(`unknown flag --${name}`);
    if (values.has(name)) throw new RehearsalError(`--${name} is given twice`);
    const value = match[2] ?? argv[index + 1];
    if (match[2] === undefined) index += 1;
    if (value === undefined || value === '' || (match[2] === undefined && value.startsWith('--'))) {
      throw new RehearsalError(`--${name} needs a value`);
    }
    values.set(name, value);
  }
  return { values, switches };
}

/** A positive integer flag value with its default and bounds. */
export function integerFlag(flags: ParsedFlags, name: string, fallback: number, min: number, max: number): number {
  const raw = flags.values.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d{1,9}$/.test(raw) || value < min || value > max) {
    throw new RehearsalError(`--${name} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return value;
}

export interface LocalDatabaseUrl {
  readonly url: string;
  readonly endpoint: Endpoint;
  readonly user: string;
}

/**
 * The URL in `env[variable]`, accepted only for a loopback host or a Unix socket and a plain database name (the
 * `db:reset` rule: these tools create and drop databases and write rows).
 */
export function localDatabaseUrl(env: NodeJS.ProcessEnv, variable: string): LocalDatabaseUrl {
  const url = env[variable];
  if (url === undefined || url === '') throw new RehearsalError(`${variable} is not set`);
  const endpoint = effectiveEndpoint(url, variable);
  if (!isLocal(endpoint.host)) {
    throw new RehearsalError(
      `${variable} must name a loopback host or a Unix socket: the rehearsal tools never run against a shared environment`,
    );
  }
  try {
    checkDatabaseName(endpoint.database);
  } catch {
    throw new RehearsalError(`${variable} must name a plain lower-case database ([a-z_][a-z0-9_]*)`);
  }
  return { url, endpoint, user: decodeURIComponent(new URL(url).username) };
}

/** Where the archive tool runs: the Compose service, the role on its socket, and the Compose project when given. */
export interface ArchiveTarget {
  readonly service: string;
  readonly user: string;
  readonly project?: string;
}

/** `--service` (default `postgres`), `--project` (default: Compose's, from the working directory) and the URL's user. */
export function archiveTarget(flags: ParsedFlags, user: string): ArchiveTarget {
  const project = flags.values.get('project');
  return { service: flags.values.get('service') ?? 'postgres', user: user || 'postgres', ...(project === undefined ? {} : { project }) };
}

/** `url` with its database replaced by `database` (query and credentials kept). */
export function withDatabase(url: string, database: string): string {
  const next = new URL(url);
  next.pathname = `/${checkDatabaseName(database)}`;
  return next.toString();
}

/** `20261121T101500Z` for a run folder or a scratch database name. */
export const utcStamp = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

/** The git-ignored artefact folder of one run (`reports/` is ignored at the repository root). */
export const defaultRunDir = (kind: string, date: Date): string => join(REPO_ROOT, 'reports', 'rehearsal', `${utcStamp(date)}-${kind}`);

/** A session over a `pg.Client` (rows only). */
export interface ClosableSession extends SqlSession {
  end(): Promise<void>;
}

export function pgSession(client: pg.Client | pg.PoolClient): ClosableSession {
  return {
    async query<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      return (await client.query<T>(sql, params === undefined ? undefined : [...params])).rows;
    },
    async end() {
      if ('release' in client) client.release();
      else await client.end();
    },
  };
}

/** The message of any thrown value, for a one-line CLI report. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
