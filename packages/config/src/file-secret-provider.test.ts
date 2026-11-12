import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import {
  createFileSecretProvider,
  SECRET_FILE_MAX_BYTES,
  SECRET_FILE_OPEN_FLAGS,
  SecretFileError,
  type SecretFileHandle,
  type SecretFileSystem,
} from './file-secret-provider.js';
import { resolveSecretRefs, SecretNotFoundError } from './secret-refs.js';

/** O_NOFOLLOW and POSIX modes do not exist on Windows (see file-secret-provider.ts); those cases run on Linux/macOS. */
const POSIX = process.platform !== 'win32';
const itOnPosix = POSIX ? it : it.skip;

/** A handle over in-memory content whose fstat reports `reportedSize`; records every read length. */
function fakeHandle(content: Uint8Array, reportedSize: number, reads: number[]): SecretFileHandle {
  return {
    stat: () => Promise.resolve({ isFile: () => true, size: reportedSize, mode: 0o100600 }),
    read: (buffer, offset, length, position) => {
      reads.push(length);
      const chunk = content.subarray(position, position + Math.min(length, 4));
      buffer.set(chunk, offset);
      return Promise.resolve({ bytesRead: chunk.byteLength });
    },
    close: () => Promise.resolve(),
  };
}

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

  it('bounds the read when the file grew after fstat: at most maxBytes + 1 bytes are read', async () => {
    const reads: number[] = [];
    const fs: SecretFileSystem = {
      realpath: (path) => Promise.resolve(path),
      open: () => Promise.resolve(fakeHandle(new Uint8Array(1024), 2, reads)),
    };
    await expect(createFileSecretProvider({ root, maxBytes: 8, fs }).resolve('/run/secrets/growing', live())).rejects.toMatchObject({
      code: 'SECRET_FILE_TOO_LARGE',
    });
    expect(reads.reduce((sum, length) => sum + Math.min(length, 4), 0)).toBeLessThanOrEqual(9);
    expect(Math.max(...reads)).toBeLessThanOrEqual(9);
  });

  it('opens the confined path once with O_RDONLY | O_NOFOLLOW (O_NOFOLLOW on POSIX only) and closes the handle', async () => {
    const opened: [string, number][] = [];
    let closed = 0;
    const value = token();
    const fs: SecretFileSystem = {
      realpath: (path) => Promise.resolve(path),
      open: (path, flags) => {
        opened.push([path, flags]);
        const handle = fakeHandle(Buffer.from(value), value.length, []);
        return Promise.resolve({ ...handle, close: () => Promise.resolve(void closed++) });
      },
    };
    await expect(createFileSecretProvider({ root, fs }).resolve('/run/secrets/once', live())).resolves.toBe(value);
    expect(opened).toEqual([[join(root, 'once'), SECRET_FILE_OPEN_FLAGS]]);
    expect(closed).toBe(1);
    expect(SECRET_FILE_OPEN_FLAGS & constants.O_NOFOLLOW).toBe(POSIX ? constants.O_NOFOLLOW : 0);
  });

  itOnPosix('refuses a final component swapped for a symlink after realpath (O_NOFOLLOW -> ELOOP)', async () => {
    const value = token();
    await writeFile(join(root, 'real_target'), value, { mode: 0o600 });
    await symlink(join(root, 'real_target'), join(root, 'swapped'));
    // realpath saw a regular file; the swap to a symlink happens before the open.
    const fs: SecretFileSystem = { realpath: (path) => Promise.resolve(path), open };
    const rejected = await createFileSecretProvider({ root, fs })
      .resolve('/run/secrets/swapped', live())
      .catch((caught: unknown) => caught);
    expect(rejected).toBeInstanceOf(SecretFileError);
    expect(rejected).toMatchObject({ code: 'ELOOP' });
    expect(String((rejected as Error).stack)).not.toContain(value);
  });

  itOnPosix('refuses a group- or world-writable secret file (mode & 0o022)', async () => {
    const provider = createFileSecretProvider({ root });
    for (const [name, mode] of [
      ['group_writable', 0o620],
      ['world_writable', 0o602],
    ] as const) {
      await writeFile(join(root, name), token());
      await chmod(join(root, name), mode);
      await expect(provider.resolve(`/run/secrets/${name}`, live())).rejects.toMatchObject({ code: 'SECRET_FILE_INSECURE_MODE' });
    }
    await writeFile(join(root, 'owner_only'), 'ok');
    await chmod(join(root, 'owner_only'), 0o600);
    await expect(provider.resolve('/run/secrets/owner_only', live())).resolves.toBe('ok');
  });

  it('honours the abort signal: before the read and during it', async () => {
    await writeFile(join(root, 'slow'), token());
    const provider = createFileSecretProvider({ root });
    const reason = new Error('stop');
    await expect(provider.resolve('/run/secrets/slow', AbortSignal.abort(reason))).rejects.toBe(reason);

    // R2-n4: abort once the read has started (not after a fixed sleep, which races realpath/open on a loaded host).
    let readStarted: () => void = () => undefined;
    const reading = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    let closed = false;
    const fs: SecretFileSystem = {
      realpath,
      open: () =>
        Promise.resolve({
          stat: () => Promise.resolve({ isFile: () => true, size: 4, mode: 0o100600 }),
          read: () => {
            readStarted();
            return new Promise<never>(() => undefined);
          },
          close: () => Promise.resolve(void (closed = true)),
        }),
    };
    const controller = new AbortController();
    const pending = createFileSecretProvider({ root, fs }).resolve('/run/secrets/slow', controller.signal);
    await reading;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(closed).toBe(true);
    const nonError = new AbortController();
    nonError.abort('not an error');
    await expect(provider.resolve('/run/secrets/slow', nonError.signal)).rejects.toMatchObject({ code: 'SECRET_FILE_IO' });
  });

  it('maps other file-system errors to a path-free SecretFileError with the errno code only', async () => {
    const failing = (error: unknown): SecretFileSystem => ({
      realpath: () => rejectWith(error),
      open: () => rejectWith(error),
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
      open: () => rejectWith(new Error('unreachable')),
    };
    await expect(createFileSecretProvider({ fs }).resolve('/run/secrets/x', live())).rejects.toBeInstanceOf(SecretNotFoundError);
    expect(seen[0]?.replaceAll('\\', '/')).toBe('/run/secrets');
  });
});
