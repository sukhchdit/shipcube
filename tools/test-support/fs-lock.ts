/**
 * Cross-process locks for tests that share one real resource across Jest workers. The Prisma schema engine in
 * `node_modules/@prisma/engines` and the generated client in `prisma/generated` are such resources: the
 * `deps:rebuild` acceptance test deletes and re-fetches the engine and regenerates the client, while the
 * Testcontainers harness runs the Prisma CLI.
 *
 * Location (PR57-SEC-01): every lock lives under `<checkout>/node_modules/.cache/shipqube-test-locks/`, never in the
 * shared temp directory, so no other user can plant a link at a predictable path; worktrees do not block each other.
 *
 * Writers ({@link withFileLock}) are exclusive. A directory is the lock (mkdir is atomic on NTFS and POSIX); it holds the
 * owner's pid. A lock whose owner process is gone, or that has had no owner file for {@link OWNERLESS_STALE_MS}, is taken
 * over atomically: it is renamed to a unique tombstone first, and only if the tombstone still holds the owner that was
 * judged dead is it removed (PR #57 R1-m1, PR57-SEC-03); otherwise it is put back. A writer re-checks that it still owns
 * its directory after the reader wait and after its work, fails with {@link LostTestLockError} if it does not, and never
 * removes a directory it no longer owns.
 *
 * Readers ({@link withReadLock}, {@link withReadLockSync}; TASK-288, D-ORCH-083, D-ORCH-098 residual) share the lock
 * among themselves and exclude writers: a suite that loads the generated client must never see a half-written tree. A
 * reader registers as a file `<pid>-<uuid>` in the readers directory, THEN checks for a writer and backs off if there is
 * one; a writer creates its directory, THEN waits until no live reader is registered. Each side announces before it looks,
 * so at least one of them sees the other. Writers win ties (a reader backs off), so a stream of readers cannot starve a
 * regeneration. Only names of exactly that form are registrations (PR57-SEC-04): anything else in the readers directory is
 * ignored, and a registration of a dead process is removed. A readers directory that is a link, or not a directory, is
 * refused before anything in it is read or removed.
 *
 * Re-entrancy is per process (PR #57 R1-n6): a reader in the writer's own process is let in, and a writer ignores its own
 * process's readers. Jest runs one test file at a time per worker process; `workerThreads` is not used (threads would
 * share a pid).
 */
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepoRoot } from './process.js';

const POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 600_000;
/** An owner file is written right after mkdir: a writer directory without one for this long was left by a killed writer. */
export const OWNERLESS_STALE_MS = 30_000;
/** A reader registration: `<pid>-<uuid>`. */
const REGISTRATION = /^([1-9]\d*)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Thrown when a writer finds that its lock directory was taken from it (a take-over race it lost). */
export class LostTestLockError extends Error {
  override readonly name = 'LostTestLockError';
}

/** A process id: a positive integer. Says nothing about liveness ({@link ownerAlive}). */
const isPid = (value: number): boolean => Number.isInteger(value) && value > 0;

function ownerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isCode = (error: unknown, ...codes: string[]): boolean => codes.includes(String((error as NodeJS.ErrnoException).code));

/** Directory that holds every test lock of this checkout. */
export function lockRoot(): string {
  return join(findRepoRoot(), 'node_modules', '.cache', 'shipqube-test-locks');
}

/** Lock directory for `name` (under {@link lockRoot}, created on demand). */
export function lockPath(name: string): string {
  const root = lockRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return join(root, name);
}

/** Directory where the readers of `name` register (beside, never inside, the writer directory). */
export function readersPath(name: string): string {
  return `${lockPath(name)}.readers`;
}

/** The raw owner file text, or undefined while it does not exist (yet). */
function readOwnerText(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, 'owner'), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Whether the writer directory `dir`, whose owner file reads `owner`, was left behind: its owner process is gone, or it has
 * had no owner for {@link OWNERLESS_STALE_MS}.
 */
function isStale(dir: string, owner: string | undefined): boolean {
  const pid = Number(owner);
  if (owner !== undefined && owner !== '') return isPid(pid) && pid !== process.pid && !ownerAlive(pid);
  try {
    return Date.now() - statSync(dir).mtimeMs > OWNERLESS_STALE_MS;
  } catch {
    return false;
  }
}

/**
 * Removes the stale writer directory `dir` that was judged stale while its owner read `seen`. The directory is renamed to a
 * unique tombstone first; only the process whose rename succeeds goes on, and if the tombstone holds another owner than
 * `seen`, a live lock was caught (a writer re-created it meanwhile): it is put back, and nothing is removed.
 */
function takeOverStale(dir: string, seen: string | undefined): void {
  const tomb = `${dir}.stale-${randomUUID()}`;
  try {
    renameSync(dir, tomb);
  } catch (error) {
    if (isCode(error, 'ENOENT', 'EPERM', 'EBUSY', 'EACCES', 'EEXIST', 'ENOTEMPTY')) return; // someone else moved it, or it is in use
    throw error;
  }
  if (readOwnerText(tomb) === seen) {
    rmSync(tomb, { recursive: true, force: true });
    return;
  }
  try {
    renameSync(tomb, dir); // a live lock: give it back (its writer re-checks ownership and fails loudly if this fails)
  } catch {
    rmSync(tomb, { recursive: true, force: true });
  }
}

/**
 * Whether a writer of another live process holds `dir`. A stale writer directory is taken over ({@link takeOverStale}) and
 * then counts as free; one whose owner file is not written yet counts as held.
 */
function foreignWriterHolds(dir: string): boolean {
  try {
    lstatSync(dir);
  } catch {
    return false;
  }
  const owner = readOwnerText(dir);
  if (owner !== undefined && Number(owner) === process.pid) return false;
  if (isStale(dir, owner)) {
    takeOverStale(dir, owner);
    try {
      lstatSync(dir);
    } catch {
      return false;
    }
  }
  return true;
}

/** The readers directory of `name` if it exists; refuses one that is a link or not a directory (PR57-SEC-01). */
function plainReadersDir(name: string): string | undefined {
  const dir = readersPath(name);
  let stats;
  try {
    stats = lstatSync(dir);
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`refusing test lock readers path ${dir}: not a plain directory`);
  return dir;
}

/** Registrations of other live processes; registrations of dead processes are removed, other entries ignored. */
function foreignReaders(name: string): string[] {
  const dir = plainReadersDir(name);
  if (dir === undefined) return [];
  return readdirSync(dir).filter((entry) => {
    const match = REGISTRATION.exec(entry);
    if (match === null) return false;
    const pid = Number(match[1]);
    if (pid === process.pid) return false;
    if (!ownerAlive(pid)) {
      rmSync(join(dir, entry), { force: true });
      return false;
    }
    return true;
  });
}

/** Test seam of {@link tryRegisterReader}: runs between the registration and the writer re-check. */
export interface ReaderHooks {
  readonly afterRegister?: () => void;
}

/**
 * One attempt to register as a reader of `name`; undefined while a writer of another process holds the lock. Exported for
 * the lock tests only (the `afterRegister` seam pins the writers-win-ties re-check, PR #57 R1-m4).
 */
export function tryRegisterReader(name: string, hooks: ReaderHooks = {}): (() => void) | undefined {
  const writer = lockPath(name);
  if (foreignWriterHolds(writer)) return undefined;
  const dir = readersPath(name);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error;
  }
  if (plainReadersDir(name) === undefined) return undefined; // removed by a finishing writer meanwhile: retry
  const mine = join(dir, `${String(process.pid)}-${randomUUID()}`);
  try {
    writeFileSync(mine, '', { flag: 'wx' });
  } catch (error) {
    if (isCode(error, 'ENOENT')) return undefined; // the directory went away between the check and the write: retry
    throw error;
  }
  const release = (): void => rmSync(mine, { force: true });
  hooks.afterRegister?.();
  if (foreignWriterHolds(writer)) {
    release(); // A writer announced itself meanwhile: writers win ties.
    return undefined;
  }
  return release;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readTimeout(name: string, timeoutMs: number): Error {
  return new Error(`timed out after ${String(timeoutMs)} ms waiting for read lock ${lockPath(name)}`);
}

/**
 * Takes a read lock synchronously (the calling thread sleeps while a writer holds it) and returns its release function.
 * For module loading, which cannot await: the `@platform/prisma/client` Jest shim (tools/db/prisma-client-locked.cjs).
 */
export function acquireReadLockSync(name: string, timeoutMs = DEFAULT_TIMEOUT_MS): () => void {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const release = tryRegisterReader(name);
    if (release !== undefined) return release;
    const left = deadline - Date.now();
    if (left <= 0) throw readTimeout(name, timeoutMs);
    sleepSync(Math.min(POLL_MS, left));
  }
}

/** Runs `fn` synchronously under a read lock of `name`. */
export function withReadLockSync<T>(name: string, fn: () => T, timeoutMs = DEFAULT_TIMEOUT_MS): T {
  const release = acquireReadLockSync(name, timeoutMs);
  try {
    return fn();
  } finally {
    release();
  }
}

/** Runs `fn` under a read lock of `name`, waiting (without blocking the event loop) while a writer holds it. */
export async function withReadLock<T>(name: string, fn: () => Promise<T> | T, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let release = tryRegisterReader(name);
  while (release === undefined) {
    if (Date.now() > deadline) throw readTimeout(name, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    release = tryRegisterReader(name);
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

const ownsLock = (dir: string): boolean => Number(readOwnerText(dir)) === process.pid;

function assertOwned(dir: string, when: string): void {
  if (!ownsLock(dir)) throw new LostTestLockError(`lost test lock ${dir} ${when}: another process took it over`);
}

/** Runs `fn` while holding the named lock exclusively (no other writer, no reader of another process). */
export async function withFileLock<T>(name: string, fn: () => Promise<T> | T, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const dir = lockPath(name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), String(process.pid));
      break;
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      const owner = readOwnerText(dir);
      if (isStale(dir, owner)) {
        takeOverStale(dir, owner);
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for test lock ${dir}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  try {
    // Readers that registered before this directory existed finish first (they are loading or running the tree).
    for (let blocking = foreignReaders(name); blocking.length > 0; blocking = foreignReaders(name)) {
      if (Date.now() > deadline) {
        throw new Error(`timed out after ${String(timeoutMs)} ms waiting for readers of test lock ${dir}: ${blocking.join(', ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    assertOwned(dir, 'while waiting for readers');
    const result = await fn();
    assertOwned(dir, 'while it ran');
    return result;
  } finally {
    if (ownsLock(dir)) {
      try {
        rmdirSync(readersPath(name)); // only when empty; a reader that registers meanwhile retries (ENOENT)
      } catch {
        // ENOTEMPTY (own-process or junk entries) or ENOENT: leave it.
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Name of the lock that guards the Prisma engine file and the generated client. */
export const PRISMA_TREE_LOCK = 'prisma-tree';
