/**
 * The one PostgreSQL TLS implementation (TASK-014; PR13-SEC-09, PR9-SEC-04, PR9-SEC-16, PR9-SEC-17). The shared
 * refusal table lives here; each consumer (api pool, seed, bootstrap) has a smoke test of its own.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import {
  DATABASE_CA_DIRECTORIES,
  databaseConnectionSettings,
  DatabaseConfigError,
  MAX_ROOT_CERTIFICATE_BYTES,
  readRootCertificate,
  tlsConfig,
  withoutQuery,
} from './db-tls.js';

/** PEM-shaped dummy text (not a certificate or a key): enough to prove the file is read into `ssl.ca`. */
const DUMMY_CA = '-----BEGIN CERTIFICATE-----\nZHVtbXktdGVzdC1jYQ==\n-----END CERTIFICATE-----\n';
const POSIX = process.platform !== 'win32';

/** The thrown error of `run`, which must be a `DatabaseConfigError`. */
function failure(run: () => unknown): DatabaseConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof DatabaseConfigError) return error;
    throw error;
  }
  throw new Error('expected a DatabaseConfigError');
}

/** Asserts the refusal: class, message, and neither the path nor a cause in it. */
function expectRefused(run: () => unknown, message: RegExp, secret?: string): void {
  const error = failure(run);
  expect(error.name).toBe('DatabaseConfigError');
  expect(error.message).toMatch(message);
  expect(error).not.toHaveProperty('cause');
  if (secret !== undefined) {
    expect(error.message).not.toContain(secret);
    expect(String(error.stack)).not.toContain(secret);
  }
}

describe('DATABASE_CA_DIRECTORIES (T-02)', () => {
  it('is a frozen list of absolute trust-store directories', () => {
    expect(DATABASE_CA_DIRECTORIES).toEqual(['/etc/ssl/certs', '/etc/ssl/platform']);
    expect(Object.isFrozen(DATABASE_CA_DIRECTORIES)).toBe(true);
  });
});

describe('readRootCertificate (PR9-SEC-16, PR9-SEC-17)', () => {
  let base: string;
  let ca: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'db-tls-'));
    ca = join(base, 'ca');
    mkdirSync(ca);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const write = (name: string, content: string | Buffer, dir = ca): string => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it('reads a CA bundle inside a CA directory', () => {
    expect(readRootCertificate(write('root.pem', DUMMY_CA), [ca])).toBe(DUMMY_CA);
  });

  it('accepts a file in a nested directory and skips CA directories that do not exist', () => {
    mkdirSync(join(ca, 'nested'));
    const path = write('root.pem', DUMMY_CA, join(ca, 'nested'));
    expect(readRootCertificate(path, [join(base, 'absent'), ca])).toBe(DUMMY_CA);
  });

  it('accepts exactly 1 MiB and refuses 1 MiB + 1 byte', () => {
    const exact = write('exact.pem', Buffer.alloc(MAX_ROOT_CERTIFICATE_BYTES, 0x41));
    expect(readRootCertificate(exact, [ca])).toHaveLength(MAX_ROOT_CERTIFICATE_BYTES);
    const over = write('over.pem', Buffer.alloc(MAX_ROOT_CERTIFICATE_BYTES + 1, 0x41));
    expectRefused(() => readRootCertificate(over, [ca]), /^connectionString sslrootcert must be a regular file of at most 1 MiB$/, over);
  });

  it('reads an empty file as an empty bundle (the loop stops at the first empty read)', () => {
    expect(readRootCertificate(write('empty.pem', ''), [ca])).toBe('');
  });

  it.each([
    ['an empty value', ''],
    ['the libpq system keyword', 'system'],
    ['a file: URL', 'file:///etc/ssl/certs/root.pem'],
    ['an upper-case FILE: URL', 'FILE:/etc/ssl/certs/root.pem'],
  ])('refuses %s without opening anything', (_label, value) => {
    expectRefused(() => readRootCertificate(value, [ca]), /^connectionString sslrootcert must name a CA bundle file$/);
  });

  it('refuses a relative path, even one that exists from the working directory', () => {
    expectRefused(
      () => readRootCertificate('package.json', [process.cwd()]),
      /^connectionString sslrootcert must be an absolute path$/,
      'package.json',
    );
  });

  it('refuses a missing file as unreadable without naming it', () => {
    const path = join(ca, 'missing-root.pem');
    expectRefused(() => readRootCertificate(path, [ca]), /^connectionString sslrootcert could not be read$/, 'missing-root');
  });

  it('refuses a file outside every CA directory, and a CA directory itself', () => {
    const outside = write('outside.pem', DUMMY_CA, base);
    expectRefused(() => readRootCertificate(outside, [ca]), /^connectionString sslrootcert must lie inside a CA directory$/, outside);
    expectRefused(() => readRootCertificate(ca, [ca]), /^connectionString sslrootcert must lie inside a CA directory$/, ca);
    expectRefused(() => readRootCertificate(outside, []), /must lie inside a CA directory/, outside);
  });

  it('refuses a `..` escape from a CA directory', () => {
    write('outside.pem', DUMMY_CA, base);
    const escape = `${ca}/../outside.pem`;
    expectRefused(() => readRootCertificate(escape, [ca]), /^connectionString sslrootcert must lie inside a CA directory$/, 'outside.pem');
    // A sibling directory sharing the CA directory's name as a prefix is outside too.
    mkdirSync(`${ca}-evil`);
    const sibling = write('root.pem', DUMMY_CA, `${ca}-evil`);
    expectRefused(() => readRootCertificate(sibling, [ca]), /must lie inside a CA directory/, sibling);
  });

  it('accepts a `..` path that resolves back inside the CA directory', () => {
    write('root.pem', DUMMY_CA);
    mkdirSync(join(ca, 'sub'));
    expect(readRootCertificate(`${ca}/sub/../root.pem`, [ca])).toBe(DUMMY_CA);
  });

  it('refuses a directory inside a CA directory as not a regular file (POSIX: fstat on the descriptor; Windows: EISDIR)', () => {
    const directory = join(ca, 'bundle.d');
    mkdirSync(directory);
    expectRefused(
      () => readRootCertificate(directory, [ca]),
      /^connectionString sslrootcert must be a regular file of at most 1 MiB$/,
      directory,
    );
  });

  if (POSIX) {
    it('POSIX: refuses a symlink inside a CA directory that points outside it', () => {
      const outside = write('outside.pem', DUMMY_CA, base);
      const link = join(ca, 'link.pem');
      symlinkSync(outside, link);
      expectRefused(() => readRootCertificate(link, [ca]), /^connectionString sslrootcert must lie inside a CA directory$/, 'outside.pem');
    });

    it('POSIX: accepts a symlink whose target stays inside a CA directory', () => {
      const target = write('target.pem', DUMMY_CA);
      const link = join(ca, 'alias.pem');
      symlinkSync(target, link);
      expect(readRootCertificate(link, [ca])).toBe(DUMMY_CA);
    });

    it('POSIX: refuses a FIFO without blocking (opened non-blocking, refused on fstat)', () => {
      const fifo = join(ca, 'root.fifo');
      execFileSync('mkfifo', [fifo]);
      expectRefused(() => readRootCertificate(fifo, [ca]), /^connectionString sslrootcert must be a regular file of at most 1 MiB$/, fifo);
    });

    it('POSIX: refuses a character device (bounded by the descriptor check)', () => {
      expectRefused(
        () => readRootCertificate('/dev/zero', ['/dev']),
        /^connectionString sslrootcert must be a regular file of at most 1 MiB$/,
        '/dev/zero',
      );
    });
  } else {
    it('Windows: a directory junction escaping the CA directory is refused like a symlink', () => {
      const outsideDir = join(base, 'outside-dir');
      mkdirSync(outsideDir);
      write('root.pem', DUMMY_CA, outsideDir);
      symlinkSync(outsideDir, join(ca, 'junction'), 'junction');
      expectRefused(() => readRootCertificate(join(ca, 'junction', 'root.pem'), [ca]), /must lie inside a CA directory/, 'root.pem');
    });
  }
});

describe('tlsConfig (PR9-SEC-04): ssl is always explicit', () => {
  let ca: string;

  beforeEach(() => {
    ca = mkdtempSync(join(tmpdir(), 'db-tls-ca-'));
  });

  afterEach(() => {
    rmSync(ca, { recursive: true, force: true });
  });

  const tls = (query: string): unknown => tlsConfig(new URLSearchParams(query), [ca]);

  it.each([
    ['no TLS selector', '', { ssl: false }],
    ['sslmode=disable', 'sslmode=disable', { ssl: false }],
    ['sslnegotiation=postgres alone', 'sslnegotiation=postgres', { ssl: false, sslnegotiation: 'postgres' }],
    ['sslmode=verify-full', 'sslmode=verify-full', { ssl: { rejectUnauthorized: true } }],
    ['sslmode=require', 'sslmode=require', { ssl: { rejectUnauthorized: true } }],
    ['sslmode=verify-ca', 'sslmode=verify-ca', { ssl: { rejectUnauthorized: true } }],
    ['sslmode=prefer', 'sslmode=prefer', { ssl: { rejectUnauthorized: true } }],
    ['sslmode=allow', 'sslmode=allow', { ssl: { rejectUnauthorized: true } }],
    ['sslnegotiation=direct alone (implies TLS)', 'sslnegotiation=direct', { ssl: { rejectUnauthorized: true }, sslnegotiation: 'direct' }],
    ['a percent-encoded sslmode value', 'sslmode=verify%2Dfull', { ssl: { rejectUnauthorized: true } }],
  ])('%s', (_label, query, expected) => {
    expect(tls(query)).toStrictEqual(expected);
  });

  it('reads sslrootcert into ssl.ca, with or without sslmode (pg reads sslrootcert alone as TLS)', () => {
    const path = join(ca, 'root.pem');
    writeFileSync(path, DUMMY_CA);
    const encoded = encodeURIComponent(path);
    expect(tls(`sslmode=verify-full&sslrootcert=${encoded}`)).toStrictEqual({ ssl: { rejectUnauthorized: true, ca: DUMMY_CA } });
    expect(tls(`sslrootcert=${encoded}`)).toStrictEqual({ ssl: { rejectUnauthorized: true, ca: DUMMY_CA } });
    // sslmode=disable does not read the file at all.
    expect(tls(`sslmode=disable&sslrootcert=${encodeURIComponent(join(ca, 'missing.pem'))}`)).toStrictEqual({ ssl: false });
  });

  it('uses DATABASE_CA_DIRECTORIES by default, so a temporary file is refused', () => {
    const path = join(ca, 'root.pem');
    writeFileSync(path, DUMMY_CA);
    expectRefused(
      () => tlsConfig(new URLSearchParams(`sslmode=verify-full&sslrootcert=${encodeURIComponent(path)}`)),
      /must lie inside a CA directory/,
      path,
    );
  });

  /** The shared refusal table: every consumer maps these to its own variable name. */
  it.each([
    ['sslmode=no-verify', /^connectionString must not disable certificate verification$/],
    ['sslmode=no%2Dverify', /^connectionString must not disable certificate verification$/],
    ['sslmode=bogus', /^connectionString sslmode is not a supported value$/],
    ['sslmode=', /^connectionString sslmode is not a supported value$/],
    ['sslmode=VERIFY-FULL', /^connectionString sslmode is not a supported value$/],
    ['sslnegotiation=fast', /^connectionString sslnegotiation must be postgres or direct$/],
    ['sslmode=disable&sslnegotiation=direct', /^connectionString sslnegotiation=direct requires TLS$/],
    ['sslmode=verify-full&sslrootcert=system', /^connectionString sslrootcert must name a CA bundle file$/],
    ['sslmode=verify-full&sslrootcert=root.pem', /^connectionString sslrootcert must be an absolute path$/],
  ])('refuses %s without echoing it', (query, message) => {
    expectRefused(() => tls(query), message, query);
  });
});

describe('withoutQuery and databaseConnectionSettings', () => {
  it('drops the query string and the fragment, keeping the authority and the database', () => {
    expect(withoutQuery(new URL('postgresql://u:p@db.internal:5432/platform?sslmode=verify-full#x'))).toBe(
      'postgresql://u:p@db.internal:5432/platform',
    );
  });

  it('returns the bare URL plus the explicit TLS settings', () => {
    expect(databaseConnectionSettings(new URL('postgres://u@h/db?sslmode=verify-full&sslnegotiation=direct'), [])).toStrictEqual({
      connectionString: 'postgres://u@h/db',
      ssl: { rejectUnauthorized: true },
      sslnegotiation: 'direct',
    });
    expect(databaseConnectionSettings(new URL('postgres://u@h/db'), [])).toStrictEqual({
      connectionString: 'postgres://u@h/db',
      ssl: false,
    });
  });

  it.each([
    ['options', 'options=-c%20search_path%3Dpublic'],
    ['a percent-encoded options', '%6Fptions=-c%20search_path%3Dpublic'],
    ['host', 'sslmode=verify-full&host=/tmp'],
    ['ssl', 'ssl=0'],
    ['a repeated sslmode', 'sslmode=verify-full&sslmode=disable'],
    ['uselibpqcompat', 'uselibpqcompat=true&sslmode=verify-full'],
  ])('refuses %s in the query without echoing it', (_label, query) => {
    expectRefused(
      () => databaseConnectionSettings(new URL(`postgresql://u@h/db?${query}`), []),
      /^connectionString carries a repeated query parameter or one outside the TLS allow-list$/,
      query,
    );
  });
});
