/**
 * Cross-process locks for tests that share one real resource across Jest workers. The Prisma schema engine in
 * `node_modules/@prisma/engines` and the generated client in `prisma/generated` are such resources: the
 * `deps:rebuild` acceptance test deletes and re-fetches the engine and regenerates the client, while the
 * Testcontainers harness runs the Prisma CLI.
 *
 * Writers ({@link withFileLock}) are exclusive. A directory is the lock (mkdir is atomic on NTFS and POSIX); it holds the
 * owner's pid, and a lock whose owner process is gone is taken over.
 *
 * Readers ({@link withReadLock}, {@link withReadLockSync}; TASK-288, D-ORCH-083, D-ORCH-098 residual) share the lock
 * among themselves and exclude writers: a suite that loads the generated client, or a child process that runs it, must
 * never see a half-written tree. A reader registers as a file `<pid>-<n>` in the readers directory, THEN checks for a
 * writer and backs off if there is one; a writer creates its directory, THEN waits until no live reader is registered.
 * Each side announces before it looks, so at least one of them sees the other. Writers win ties (a reader backs off), so a
 * stream of readers cannot starve a regeneration. A reader in the writer's own process is let in (re-entrant), and a
 * registration or writer directory left by a dead process is removed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findRepoRoot } from './process.js';

const POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 600_000;

function ownerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Lock directory for `name`, scoped to this checkout (worktrees do not block each other). */
export function lockPath(name: string): string {
  const scope = createHash('sha256').update(findRepoRoot()).digest('hex').slice(0, 12);
  return join(tmpdir(), `shipqube-test-lock-${scope}-${name}`);
}

/** Directory where the readers of `name` register (beside, never inside, the writer directory). */
export function readersPath(name: string): string {
  return `${lockPath(name)}.readers`;
}

function readOwner(dir: string): number {
  try {
    return Number(readFileSync(join(dir, 'owner'), 'utf8'));
  } catch {
    return Number.NaN; // The owner file is written right after mkdir; the caller retries on the next poll.
  }
}

/** A live process id other than this one (an unreadable or empty value is not a pid). */
const isPid = (value: number): boolean => Number.isInteger(value) && value > 0;

/**
 * Whether a writer of another live process holds `dir`. A writer directory whose owner is gone is removed (the same
 * take-over {@link withFileLock} does); one whose owner file is not written yet counts as held.
 */
function foreignWriterHolds(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const owner = readOwner(dir);
  if (owner === process.pid) return false;
  if (isPid(owner) && !ownerAlive(owner)) {
    rmSync(dir, { recursive: true, force: true });
    return false;
  }
  return true;
}

/** Registered readers of other live processes; registrations of dead processes are removed on the way. */
function foreignReaders(name: string): string[] {
  const dir = readersPath(name);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((entry) => {
    const pid = Number(entry.split('-')[0]);
    if (pid === process.pid) return false;
    if (isPid(pid) && !ownerAlive(pid)) {
      rmSync(join(dir, entry), { force: true });
      return false;
    }
    return true;
  });
}

let readerSeq = 0;

/** One attempt to register as a reader; undefined while a writer of another process holds the lock. */
function tryRegisterReader(name: string): (() => void) | undefined {
  const writer = lockPath(name);
  if (foreignWriterHolds(writer)) return undefined;
  const dir = readersPath(name);
  mkdirSync(dir, { recursive: true });
  readerSeq += 1;
  const mine = join(dir, `${String(process.pid)}-${String(readerSeq)}`);
  writeFileSync(mine, '', { flag: 'wx' });
  const release = (): void => rmSync(mine, { force: true });
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
 * For module loading, which cannot await: the `@platform/prisma/client` Jest shim (tools/test-support/prisma-client.cjs).
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
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = readOwner(dir);
      if (Number.isInteger(owner) && owner !== process.pid && !ownerAlive(owner)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for test lock ${dir}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  try {
    // Readers that registered before this directory existed finish first (they are loading or running the tree).
    while (foreignReaders(name).length > 0) {
      if (Date.now() > deadline) throw new Error(`timed out after ${String(timeoutMs)} ms waiting for readers of test lock ${dir}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Name of the lock that guards the Prisma engine file and the generated client. */
export const PRISMA_TREE_LOCK = 'prisma-tree';
