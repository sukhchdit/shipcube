/**
 * `file` secret provider (ADR-0018 §3; PR3-SEC-07): reads Compose/ECS secret files mounted under `/run/secrets`.
 *
 * The parser already confines `file:` locators lexically to `/run/secrets/<segment>[/<segment>…]`. This adapter
 * maps the locator onto `root`, then confines the REAL path: `realpath(target)` must stay inside
 * `realpath(root)`, so a symlink or junction that points elsewhere is refused. The confined path is then opened ONCE
 * with `O_RDONLY | O_NOFOLLOW` and every later check runs on that handle (PR3-SEC-07 residual): `fstat` says it is a
 * regular file of at most `maxBytes` that is not group- or world-writable (`mode & 0o022`), and the read is bounded
 * to `maxBytes + 1` bytes, so a file swapped for a symlink or grown after the checks cannot be followed or
 * materialised. The read honours the abort signal; one trailing newline is removed. Every error is value-free and
 * path-free: a missing file is `SecretNotFoundError`, anything else is `SecretFileError` with an errno-style code.
 */
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { SECRET_FILE_ROOT, SecretNotFoundError, type SecretProvider } from './secret-refs.js';

/** Largest secret file accepted by default (64 KiB). */
export const SECRET_FILE_MAX_BYTES = 64 * 1024;

/**
 * Windows has no `O_NOFOLLOW` (`fs.constants.O_NOFOLLOW` is undefined there), and its file modes are synthesised
 * (always 0o666 for writable files), so neither check means anything on a Windows dev host. The provider runs in
 * Linux containers, where both apply; on Windows the realpath confinement and the regular-file check remain.
 */
const IS_WINDOWS = process.platform === 'win32';
/** Flags of the single open: read-only, and never through a symlink in the final component (POSIX). */
export const SECRET_FILE_OPEN_FLAGS = constants.O_RDONLY | (IS_WINDOWS ? 0 : constants.O_NOFOLLOW);
/** Group- or world-writable secret files are refused (POSIX). */
const WRITABLE_BY_OTHERS = 0o022;

/** `fstat` result fields the provider reads. */
export interface SecretFileStats {
  isFile(): boolean;
  readonly size: number;
  readonly mode: number;
}

/** An open file; `node:fs/promises` FileHandle satisfies it. */
export interface SecretFileHandle {
  stat(): Promise<SecretFileStats>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>;
  close(): Promise<void>;
}

/** File-system operations the provider needs; a seam so tests can simulate slow reads and races. */
export interface SecretFileSystem {
  realpath(path: string): Promise<string>;
  open(path: string, flags: number): Promise<SecretFileHandle>;
}

export interface FileSecretProviderOptions {
  /** Directory standing in for `/run/secrets`; defaults to `/run/secrets`. */
  readonly root?: string;
  /** Size cap in bytes; defaults to `SECRET_FILE_MAX_BYTES`. */
  readonly maxBytes?: number;
  /** File-system seam; defaults to `node:fs/promises`. */
  readonly fs?: SecretFileSystem;
}

/** Codes of `SecretFileError` besides pass-through errno codes (`EACCES`, `ELOOP`, …). */
export const SECRET_FILE_ERROR_CODES = [
  'SECRET_FILE_OUTSIDE_ROOT',
  'SECRET_FILE_NOT_REGULAR',
  'SECRET_FILE_TOO_LARGE',
  'SECRET_FILE_INSECURE_MODE',
  'SECRET_FILE_IO',
] as const;

/** A secret file was refused or could not be read. Carries a fixed message and an errno-style code; no path. */
export class SecretFileError extends Error {
  override readonly name = 'SecretFileError';
  readonly code: string;

  constructor(code: string) {
    super('Secret file could not be read');
    this.code = code;
  }
}

const NODE_FS: SecretFileSystem = { realpath, open };
const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);
const ERRNO_CODE = /^E[A-Z]{2,15}$/;
const LOCATOR_PREFIX = `${SECRET_FILE_ROOT}/`;
const TRAILING_NEWLINE = /\r?\n$/;

/** Turns a file-system failure into a path-free error; the abort reason passes through unchanged. */
function translateFsError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return signal.reason instanceof Error ? signal.reason : new SecretFileError('SECRET_FILE_IO');
  if (error instanceof SecretFileError) return error;
  const code: unknown = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && NOT_FOUND_CODES.has(code)) return new SecretNotFoundError();
  return new SecretFileError(typeof code === 'string' && ERRNO_CODE.test(code) ? code : 'SECRET_FILE_IO');
}

/** Settles with `operation`, or rejects with the abort reason as soon as `signal` aborts. */
async function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason as Error);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Reads at most `limit` bytes from the start of the file, stopping at end of file; checks `signal` per chunk. */
async function readBounded(handle: SecretFileHandle, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const buffer = new Uint8Array(limit);
  let total = 0;
  while (total < limit) {
    const { bytesRead } = await untilAborted(handle.read(buffer, total, limit - total, total), signal);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

const isWithin = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};

/** Creates the `file` provider. `root` and `fs` are parameters (no environment seam). */
export function createFileSecretProvider(options: FileSecretProviderOptions = {}): SecretProvider {
  const root = options.root ?? SECRET_FILE_ROOT;
  const maxBytes = options.maxBytes ?? SECRET_FILE_MAX_BYTES;
  const fs = options.fs ?? NODE_FS;

  async function read(locator: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (!locator.startsWith(LOCATOR_PREFIX)) throw new SecretFileError('SECRET_FILE_OUTSIDE_ROOT');
    const realRoot = await fs.realpath(root);
    const realTarget = await fs.realpath(join(root, ...locator.slice(LOCATOR_PREFIX.length).split('/')));
    if (!isWithin(realRoot, realTarget)) throw new SecretFileError('SECRET_FILE_OUTSIDE_ROOT');
    signal.throwIfAborted();
    const handle = await fs.open(realTarget, SECRET_FILE_OPEN_FLAGS);
    try {
      const info = await untilAborted(handle.stat(), signal);
      if (!info.isFile()) throw new SecretFileError('SECRET_FILE_NOT_REGULAR');
      if (!IS_WINDOWS && (info.mode & WRITABLE_BY_OTHERS) !== 0) throw new SecretFileError('SECRET_FILE_INSECURE_MODE');
      if (info.size > maxBytes) throw new SecretFileError('SECRET_FILE_TOO_LARGE');
      const bytes = await readBounded(handle, maxBytes + 1, signal);
      if (bytes.byteLength > maxBytes) throw new SecretFileError('SECRET_FILE_TOO_LARGE');
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8').replace(TRAILING_NEWLINE, '');
    } finally {
      await handle.close();
    }
  }

  return Object.freeze({
    kind: 'file' as const,
    async resolve(locator: string, signal: AbortSignal): Promise<string> {
      try {
        return await read(locator, signal);
      } catch (error) {
        throw translateFsError(error, signal);
      }
    },
  });
}
