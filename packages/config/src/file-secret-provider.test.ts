import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createFileSecretProvider, SECRET_FILE_MAX_BYTES, SecretFileError, type SecretFileSystem } from './file-secret-provider.js';
import { resolveSecretRefs, SecretNotFoundError } from './secret-refs.js';

const token = (): string => randomBytes(16).toString('hex');
const live = (): AbortSignal => new AbortController().signal;
/** Rejects with any reason, Errors or not: the file system seam is fed non-Error rejections too. */
const rejectWith = (reason: unknown): Promise<never> =>
  new Promise<never>(() => {
    throw reason;
  });

describe('file secret provider (PR3-SEC-07, m4)', () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'file-secret-provider-'));
    root = join(base, 'secrets');
    outside = join(base, 'outside');
    await mkdir(join(root, 'carriers'), { recursive: true });
    await mkdir(outside);
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('reads a secret file and trims one trailing newline only', async () => {
    const value = token();
    await writeFile(join(root, 'stripe_key'), `${value}\n`);
    await writeFile(join(root, 'carriers', 'dhl.json'), `${value}\r\n\n`);
    await writeFile(join(root, 'crlf'), `${value}\r\n`);
    const provider = createFileSecretProvider({ root });
    expect(provider.kind).toBe('file');
    await expect(provider.resolve('/run/secrets/stripe_key', live())).resolves.toBe(value);
    await expect(provider.resolve('/run/secrets/carriers/dhl.json', live())).resolves.toBe(`${value}\r\n`);
    await expect(provider.resolve('/run/secrets/crlf', live())).resolves.toBe(value);
  });

  it('resolves through the orchestrator into a Secret', async () => {
    const value = token();
    await writeFile(join(root, 'smtp_password'), value);
    const resolved = await resolveSecretRefs(
      new Map([['SMTP_PASSWORD_REF', { provider: 'file', locator: '/run/secrets/smtp_password' }]]),
      [createFileSecretProvider({ root })],
    );
    expect(resolved.get('SMTP_PASSWORD_REF')?.reveal()).toBe(value);
  });

  it('a missing file (or a file used as a directory) is SecretNotFoundError, reported as ref.notFound', async () => {
    const provider = createFileSecretProvider({ root });
    await expect(provider.resolve('/run/secrets/absent', live())).rejects.toBeInstanceOf(SecretNotFoundError);
    await writeFile(join(root, 'plain'), token());
    await expect(provider.resolve('/run/secrets/plain/child', live())).rejects.toBeInstanceOf(SecretNotFoundError);
    const error = await resolveSecretRefs(new Map([['X_REF', { provider: 'file', locator: '/run/secrets/absent' }]]), [provider]).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ issues: [{ key: 'X_REF', code: 'unresolvable', rule: 'ref.notFound' }] });
  });

  it('refuses a locator outside /run/secrets or one that traverses out of the root (defence in depth)', async () => {
    await writeFile(join(outside, 'target'), token());
    const provider = createFileSecretProvider({ root });
    for (const locator of ['/etc/shadow', '/run/secrets/../outside/target']) {
      await expect(provider.resolve(locator, live())).rejects.toMatchObject({ name: 'SecretFileError', code: 'SECRET_FILE_OUTSIDE_ROOT' });
    }
  });

  it('refuses a link inside the root that points outside it (realpath confinement)', async () => {
    const value = token();
    await writeFile(join(outside, 'host_secret'), value);
    // A junction needs no privilege on Windows; on POSIX the type argument is ignored and a directory symlink is made.
    await symlink(outside, join(root, 'escape'), 'junction');
    const provider = createFileSecretProvider({ root });
    const rejected = await provider.resolve('/run/secrets/escape/host_secret', live()).catch((caught: unknown) => caught);
    expect(rejected).toBeInstanceOf(SecretFileError);
    expect(rejected).toMatchObject({ code: 'SECRET_FILE_OUTSIDE_ROOT', message: 'Secret file could not be read' });
    expect(String((rejected as Error).stack)).not.toContain(value);
    expect(String((rejected as Error).stack)).not.toContain(outside);
  });

  it('refuses the root itself and directories (not a regular file)', async () => {
    const provider = createFileSecretProvider({ root });
    await expect(provider.resolve('/run/secrets/carriers', live())).rejects.toMatchObject({ code: 'SECRET_FILE_NOT_REGULAR' });
    await expect(provider.resolve('/run/secrets/', live())).rejects.toMatchObject({ code: 'SECRET_FILE_OUTSIDE_ROOT' });
  });

  it('refuses a file larger than the cap', async () => {
    await writeFile(join(root, 'big'), Buffer.alloc(SECRET_FILE_MAX_BYTES + 1, 0x61));
    await expect(createFileSecretProvider({ root }).resolve('/run/secrets/big', live())).rejects.toMatchObject({
      code: 'SECRET_FILE_TOO_LARGE',
    });
    await writeFile(join(root, 'small'), 'abcdef');
    await expect(createFileSecretProvider({ root, maxBytes: 4 }).resolve('/run/secrets/small', live())).rejects.toMatchObject({
      code: 'SECRET_FILE_TOO_LARGE',
    });
    const error = await resolveSecretRefs(
      new Map([['BIG_REF', { provider: 'file', locator: '/run/secrets/big' }]]),
      [createFileSecretProvider({ root })],
      { sleep: () => Promise.resolve() },
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      issues: [{ key: 'BIG_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'SecretFileError/SECRET_FILE_TOO_LARGE' }],
    });
  });

  it('refuses a file that grew past the cap between stat and read', async () => {
    await writeFile(join(root, 'growing'), 'ab');
    const fs: SecretFileSystem = { realpath, stat, readFile: () => Promise.resolve(new Uint8Array(16)) };
    await expect(createFileSecretProvider({ root, maxBytes: 8, fs }).resolve('/run/secrets/growing', live())).rejects.toMatchObject({
      code: 'SECRET_FILE_TOO_LARGE',
    });
  });

  it('honours the abort signal: before the read and during it', async () => {
    await writeFile(join(root, 'slow'), token());
    const provider = createFileSecretProvider({ root });
    const reason = new Error('stop');
    await expect(provider.resolve('/run/secrets/slow', AbortSignal.abort(reason))).rejects.toBe(reason);

    let received: AbortSignal | undefined;
    const fs: SecretFileSystem = {
      realpath,
      stat,
      readFile: (_path, { signal }) => {
        received = signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('read aborted'))));
      },
    };
    const controller = new AbortController();
    const pending = createFileSecretProvider({ root, fs }).resolve('/run/secrets/slow', controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(received).toBe(controller.signal);
    const nonError = new AbortController();
    nonError.abort('not an error');
    await expect(provider.resolve('/run/secrets/slow', nonError.signal)).rejects.toMatchObject({ code: 'SECRET_FILE_IO' });
  });

  it('maps other file-system errors to a path-free SecretFileError with the errno code only', async () => {
    const failing = (error: unknown): SecretFileSystem => ({
      realpath: () => rejectWith(error),
      stat,
      readFile: () => rejectWith(error),
    });
    const eacces = Object.assign(new Error(`EACCES: permission denied, open '${root}'`), { code: 'EACCES' });
    const cases: readonly [unknown, string][] = [
      [eacces, 'EACCES'],
      [Object.assign(new Error('odd'), { code: 'not-errno' }), 'SECRET_FILE_IO'],
      [new Error('no code'), 'SECRET_FILE_IO'],
      [null, 'SECRET_FILE_IO'],
    ];
    for (const [thrown, code] of cases) {
      const rejected = await createFileSecretProvider({ root, fs: failing(thrown) })
        .resolve('/run/secrets/any', live())
        .catch((caught: unknown) => caught);
      expect(rejected).toBeInstanceOf(SecretFileError);
      expect(rejected).toMatchObject({ code });
      expect(String((rejected as Error).stack)).not.toContain(root);
    }
  });

  it('defaults to /run/secrets as the root', async () => {
    const seen: string[] = [];
    const fs: SecretFileSystem = {
      realpath: (path) => {
        seen.push(path);
        return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      },
      stat,
      readFile: () => Promise.resolve(new Uint8Array()),
    };
    await expect(createFileSecretProvider({ fs }).resolve('/run/secrets/x', live())).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(seen[0]?.replaceAll('\\', '/')).toBe('/run/secrets');
  });
});
