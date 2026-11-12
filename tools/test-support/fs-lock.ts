/**
 * Cross-process mutex for tests that share one real resource across Jest workers. The Prisma schema engine in
 * `node_modules/@prisma/engines` and the generated client in `prisma/generated` are such resources: the
 * `deps:rebuild` acceptance test deletes and re-fetches the engine and regenerates the client, while the
 * Testcontainers harness runs the Prisma CLI. A directory is the lock (mkdir is atomic on NTFS and POSIX); it holds
 * the owner's pid, and a lock whose owner process is gone is taken over.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findRepoRoot } from './process.js';

const POLL_MS = 200;

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

/** Runs `fn` while holding the named lock. Waits up to `timeoutMs` for it. */
export async function withFileLock<T>(name: string, fn: () => Promise<T> | T, timeoutMs = 600_000): Promise<T> {
  const dir = lockPath(name);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'owner'), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let owner = Number.NaN;
      try {
        owner = Number(readFileSync(join(dir, 'owner'), 'utf8'));
      } catch {
        // The owner file is written right after mkdir; retry on the next poll.
      }
      if (Number.isInteger(owner) && owner !== process.pid && !ownerAlive(owner)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for test lock ${dir}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Name of the lock that guards the Prisma engine file and the generated client. */
export const PRISMA_TREE_LOCK = 'prisma-tree';
