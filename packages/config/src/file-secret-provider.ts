/**
 * `file` secret provider (ADR-0018 §3; PR3-SEC-07): reads Compose/ECS secret files mounted under `/run/secrets`.
 *
 * The parser already confines `file:` locators lexically to `/run/secrets/<segment>[/<segment>…]`. This adapter
 * maps the locator onto `root`, then confines the REAL path: `realpath(target)` must stay inside
 * `realpath(root)`, so a symlink or junction that points elsewhere is refused. The file must be a regular file
 * of at most `maxBytes`; the read honours the abort signal; one trailing newline is removed. Every error is
 * value-free and path-free: a missing file is `SecretNotFoundError`, anything else is `SecretFileError` with an
 * errno-style code only.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

import { SECRET_FILE_ROOT, SecretNotFoundError, type SecretProvider } from './secret-refs.js';

/** Largest secret file accepted by default (64 KiB). */
export const SECRET_FILE_MAX_BYTES = 64 * 1024;

/** File-system operations the provider needs; a seam so tests can simulate slow reads and races. */
export interface SecretFileSystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean; readonly size: number }>;
  readFile(path: string, options: { readonly signal: AbortSignal }): Promise<Uint8Array>;
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

const NODE_FS: SecretFileSystem = { realpath, stat, readFile };
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
    const info = await fs.stat(realTarget);
    if (!info.isFile()) throw new SecretFileError('SECRET_FILE_NOT_REGULAR');
    if (info.size > maxBytes) throw new SecretFileError('SECRET_FILE_TOO_LARGE');
    const bytes = await fs.readFile(realTarget, { signal });
    if (bytes.byteLength > maxBytes) throw new SecretFileError('SECRET_FILE_TOO_LARGE');
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8').replace(TRAILING_NEWLINE, '');
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
