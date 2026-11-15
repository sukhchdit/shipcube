/**
 * One TLS implementation for every PostgreSQL client (TASK-014; PR13-SEC-09, PR9-SEC-04, PR9-SEC-16, PR9-SEC-17).
 * The runtime pool (apps/api `toPoolConfig`, shared by the worker), the seed's migrator connection
 * (prisma/seed/migrator-connection.ts) and the bootstrap runner (tools/db/bootstrap.ts) all hand `pg` the URL without
 * its query string plus the explicit settings returned here, so that:
 *  - `pg` never derives TLS from the URL (URL-derived settings replace an explicit `ssl` object);
 *  - `PGSSLMODE` cannot switch TLS on or off (`pg` reads it only when `ssl` is unset; `no-verify` turns verification
 *    off), because `ssl` is ALWAYS explicit: `false` or `{ rejectUnauthorized: true, ca? }`;
 *  - `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot turn verification off, because `rejectUnauthorized` is pinned.
 * Every error is a `DatabaseConfigError` whose message is fixed text: never the URL, a path, a value or an fs error
 * message, and never a `cause`.
 */
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import { DATABASE_SSLMODES, hasOnlyRuntimeDatabaseUrlParams } from './guards.js';

/** A PostgreSQL connection setting is unusable. Moved here from apps/api (TASK-014 T-01); the API re-exports it. */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/**
 * Directories a `sslrootcert` file may live in (PR9-SEC-17, TASK-014 T-02): the Debian/Alpine trust-store directory
 * and the platform's own CA mount. The file's real path (symlinks and `..` resolved) must lie strictly inside one of
 * them. Tests pass their own list through the `caDirectories` parameter; there is no environment override.
 */
export const DATABASE_CA_DIRECTORIES: readonly string[] = Object.freeze(['/etc/ssl/certs', '/etc/ssl/platform']);

/** A CA bundle is small (the RDS global bundle is about 160 kB); the cap keeps a wrong file from exhausting memory. */
export const MAX_ROOT_CERTIFICATE_BYTES = 1_048_576;

/** `sslnegotiation` values `pg` understands. */
export type DatabaseSslNegotiation = 'postgres' | 'direct';

/** The explicit `ssl` setting: plain TCP, or TLS verified as libpq `verify-full` (optionally against a named CA). */
export type DatabaseSsl = false | { readonly rejectUnauthorized: true; readonly ca?: string };

/** The TLS part of a `pg` client or pool config, derived from the allow-listed URL parameters only. */
export interface DatabaseTlsConfig {
  readonly ssl: DatabaseSsl;
  readonly sslnegotiation?: DatabaseSslNegotiation;
}

/** `connectionString` (no query string) plus the explicit TLS settings: what a `pg` client may be given. */
export interface DatabaseConnectionSettings extends DatabaseTlsConfig {
  readonly connectionString: string;
}

/** `sslmode` values that select TLS; every one of them is verified as libpq `verify-full` (see `tlsConfig`). */
const TLS_SSLMODES: ReadonlySet<string> = new Set([...DATABASE_SSLMODES].filter((mode) => mode !== 'disable'));

const isSslNegotiation = (value: string): value is DatabaseSslNegotiation => value === 'postgres' || value === 'direct';

function refuse(problem: string): never {
  throw new DatabaseConfigError(`connectionString ${problem}`);
}

/** `target` lies strictly inside `directory` (both real paths). */
const isInside = (directory: string, target: string): boolean => {
  const path = relative(directory, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/** The real paths of the CA directories that exist; a missing one simply admits nothing. */
const realDirectories = (caDirectories: readonly string[]): string[] =>
  caDirectories.flatMap((directory) => {
    try {
      return [realpathSync(directory)];
    } catch {
      return [];
    }
  });

const errorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;

/** Reads at most `MAX_ROOT_CERTIFICATE_BYTES + 1` bytes from `fd`; more than the cap is refused. */
function readBounded(fd: number): string {
  const buffer = Buffer.alloc(MAX_ROOT_CERTIFICATE_BYTES + 1);
  let total = 0;
  // Bounded by the buffer: `total` only grows, and the loop stops at the first empty read or a full buffer. A procfs
  // file that reports size 0 is therefore bounded by the bytes it actually yields.
  while (total < buffer.length) {
    const read = readSync(fd, buffer, total, buffer.length - total, null);
    if (read === 0) break;
    total += read;
  }
  if (total > MAX_ROOT_CERTIFICATE_BYTES) refuse('sslrootcert must be a regular file of at most 1 MiB');
  return buffer.toString('utf8', 0, total);
}

/**
 * PR9-SEC-16/-17: the CA bundle named by `sslrootcert`. Refused without opening anything: libpq's `system` keyword
 * (pinning means a named bundle), an empty value, a `file:` URL and a relative path. The real path must lie inside one
 * of `caDirectories`. The file is opened ONCE, read-only and non-blocking, and checked on the descriptor, so a FIFO, a
 * device or a directory is refused without blocking start-up; at most 1 MiB is read. No message names the path.
 */
export function readRootCertificate(path: string, caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES): string {
  if (path === '' || path === 'system' || /^file:/i.test(path)) refuse('sslrootcert must name a CA bundle file');
  if (!isAbsolute(path)) refuse('sslrootcert must be an absolute path');
  let fd: number | undefined;
  try {
    const target = realpathSync(path);
    if (!realDirectories(caDirectories).some((directory) => isInside(directory, target))) {
      refuse('sslrootcert must lie inside a CA directory');
    }
    // O_NOFOLLOW: the real path has no symlink as its last component, so a symlink swapped in now is refused too.
    fd = openSync(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile()) refuse('sslrootcert must be a regular file of at most 1 MiB');
    return readBounded(fd);
  } catch (error) {
    if (error instanceof DatabaseConfigError) throw error;
    // Windows cannot open a directory: the same refusal as the descriptor check on POSIX.
    if (errorCode(error) === 'EISDIR') refuse('sslrootcert must be a regular file of at most 1 MiB');
    // Neither the path nor the fs error (which names the path) is echoed.
    return refuse('sslrootcert could not be read');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Explicit `pg` TLS settings for the URL's TLS selectors (PR9-SEC-04). Values are percent-decoded, as pg reads them.
 *
 * - no `sslmode` (and neither `sslrootcert` nor `sslnegotiation=direct`), or `sslmode=disable` → `ssl: false`, set
 *   explicitly so that `PGSSLMODE` cannot switch on an unverified connection;
 * - `sslmode=no-verify` or any value outside `DATABASE_SSLMODES` → refused;
 * - `allow`, `prefer`, `require`, `verify-ca`, `verify-full` (or no `sslmode` with `sslrootcert` or
 *   `sslnegotiation=direct`, which pg also reads as TLS) → `rejectUnauthorized: true` with Node's default host-name
 *   check, i.e. libpq `verify-full`; `sslrootcert` is read into `ca`; `sslnegotiation` is passed through, and
 *   `direct` without TLS is refused.
 */
export function tlsConfig(params: URLSearchParams, caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES): DatabaseTlsConfig {
  const sslmode = params.get('sslmode');
  const sslnegotiation = params.get('sslnegotiation');
  const sslrootcert = params.get('sslrootcert');
  if (sslmode === 'no-verify') refuse('must not disable certificate verification');
  if (sslmode !== null && !DATABASE_SSLMODES.has(sslmode)) refuse('sslmode is not a supported value');
  if (sslnegotiation !== null && !isSslNegotiation(sslnegotiation)) refuse('sslnegotiation must be postgres or direct');
  const negotiation = sslnegotiation === null ? {} : { sslnegotiation };
  const tls = sslmode === null ? sslnegotiation === 'direct' || sslrootcert !== null : TLS_SSLMODES.has(sslmode);
  if (!tls) {
    if (sslnegotiation === 'direct') refuse('sslnegotiation=direct requires TLS');
    return { ssl: false, ...negotiation };
  }
  return {
    ssl: { rejectUnauthorized: true, ...(sslrootcert === null ? {} : { ca: readRootCertificate(sslrootcert, caDirectories) }) },
    ...negotiation,
  };
}

/** The URL without its query string and fragment: what pg may parse (host, port, user, password, database only). */
export function withoutQuery(url: URL): string {
  const bare = new URL(url.href);
  bare.search = '';
  bare.hash = '';
  return bare.href;
}

/**
 * The connection settings every PostgreSQL client in the platform uses: only the TLS selectors of
 * `RUNTIME_DATABASE_URL_PARAMS`, each at most once (pg copies every query entry over explicit settings, so `options`,
 * `host`, `ssl`, timeouts, ... would override them; PR5-SEC-08), then the URL without its query plus `tlsConfig`.
 * Names are compared after percent-decoding, as pg reads them. The offending name is not echoed.
 */
export function databaseConnectionSettings(
  url: URL,
  caDirectories: readonly string[] = DATABASE_CA_DIRECTORIES,
): DatabaseConnectionSettings {
  if (!hasOnlyRuntimeDatabaseUrlParams(url)) refuse('carries a repeated query parameter or one outside the TLS allow-list');
  return { connectionString: withoutQuery(url), ...tlsConfig(url.searchParams, caDirectories) };
}
