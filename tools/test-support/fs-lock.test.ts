// Reader side of the test locks (TASK-288 = TASK-W0-FLAKE-2; D-ORCH-083, D-ORCH-098 residual, D-ARCH-137; NFR-MAINT-002).
// The writer side (`withFileLock`) predates this task and now also waits for readers of other processes. Every concurrent
// party is a real child process (tools/test-support/lock-children.ts); assertions are about ORDER, never elapsed time.
// The `@platform/prisma/client` shim on top of this lock is tested in tools/db/prisma-client-locked.test.ts.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import { acquireReadLockSync, lockPath, readersPath, withFileLock, withReadLock, withReadLockSync } from './fs-lock.js';
import { deadPid, LockChildren, READER, WRITER } from './lock-children.js';

// Each case waits for a child process to start (hundreds of ms on a loaded host); this is a hang detector only.
jest.setTimeout(120_000);

const scratch = mkdtempSync(join(tmpdir(), 'shipqube-fs-lock-'));
const children = new LockChildren(scratch);
let seq = 0;
const names: string[] = [];
/** A lock name no other suite uses, so these cases never block the real prisma-tree writers. */
const freshName = (): string => {
  seq += 1;
  const name = `t288-${String(process.pid)}-${String(seq)}`;
  names.push(name);
  return name;
};
const registrations = (name: string): string[] => (existsSync(readersPath(name)) ? readdirSync(readersPath(name)) : []);

afterEach(() => children.killAll());
afterAll(() => {
  // A child killed while holding (the deadline cases) leaves its lock directory behind; remove every one this suite named.
  for (const name of names) for (const dir of [lockPath(name), readersPath(name)]) rmSync(dir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe('test lock: readers against a writer of another process (D-ORCH-083, D-ORCH-098 residual)', () => {
  it('a synchronous reader waits while another process holds the writer lock and enters only after it lets go', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '400'], ready);

    const sawRelease = withReadLockSync(name, () => existsSync(released));

    expect(sawRelease).toBe(true);
  });

  it('an asynchronous reader waits while another process holds the writer lock', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '400'], ready);

    const sawRelease = await withReadLock(name, () => existsSync(released));

    expect(sawRelease).toBe(true);
  });

  it('the writer waits for a live reader of another process before it runs', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(READER, [readersPath(name), ready, released, '400'], ready);

    const sawRelease = await withFileLock(name, () => existsSync(released));

    expect(sawRelease).toBe(true);
  });

  it('readers do not exclude each other: a reader enters while another process holds a read lock', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(READER, [readersPath(name), ready, released, '60000'], ready);

    const enteredBeforeOtherLetGo = withReadLockSync(name, () => !existsSync(released));

    expect(enteredBeforeOtherLetGo).toBe(true);
  });

  it('a reader releases its registration, so a later writer does not wait for it', async () => {
    const name = freshName();
    withReadLockSync(name, () => undefined);
    await withReadLock(name, () => undefined);

    expect(registrations(name)).toEqual([]);
    await expect(withFileLock(name, () => 'ran', 5_000)).resolves.toBe('ran');
  });

  it('a reader that throws still releases its registration (sync and async)', async () => {
    const name = freshName();

    expect(() =>
      withReadLockSync(name, () => {
        throw new Error('load failed');
      }),
    ).toThrow('load failed');
    await expect(withReadLock(name, () => Promise.reject(new Error('run failed')))).rejects.toThrow('run failed');
    expect(registrations(name)).toEqual([]);
  });

  it('a reader inside the writer of its own process is re-entrant (no self-deadlock)', async () => {
    const name = freshName();

    const value = await withFileLock(name, () => withReadLockSync(name, () => 'inner', 2_000), 5_000);

    expect(value).toBe('inner');
  });

  it('a writer lock left by a dead process is taken over by a reader', async () => {
    const name = freshName();
    mkdirSync(lockPath(name));
    writeFileSync(join(lockPath(name), 'owner'), String(await deadPid()));

    expect(withReadLockSync(name, () => 'entered', 5_000)).toBe('entered');
    expect(existsSync(lockPath(name))).toBe(false);
  });

  it('a reader registration left by a dead process does not block the writer and is removed', async () => {
    const name = freshName();
    mkdirSync(readersPath(name), { recursive: true });
    const stale = join(readersPath(name), `${String(await deadPid())}-0`);
    writeFileSync(stale, '');

    await expect(withFileLock(name, () => 'ran', 5_000)).resolves.toBe('ran');
    expect(existsSync(stale)).toBe(false);
  });

  it('a synchronous reader that cannot get in before its deadline fails naming the lock and leaves no registration', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '60000'], ready);

    expect(() => acquireReadLockSync(name, 300)).toThrow(`timed out after 300 ms waiting for read lock ${lockPath(name)}`);
    expect(registrations(name)).toEqual([]);
  });

  it('an asynchronous reader that cannot get in before its deadline fails naming the lock', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '60000'], ready);

    await expect(withReadLock(name, () => 'ran', 300)).rejects.toThrow(`timed out after 300 ms waiting for read lock ${lockPath(name)}`);
    expect(registrations(name)).toEqual([]);
  });

  it('a writer that cannot outwait a live reader fails naming the lock and gives the writer lock back', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(READER, [readersPath(name), ready, released, '60000'], ready);

    await expect(withFileLock(name, () => 'ran', 300)).rejects.toThrow(
      `timed out after 300 ms waiting for readers of test lock ${lockPath(name)}`,
    );
    expect(existsSync(lockPath(name))).toBe(false);
  });
});

describe('the D-ORCH-083 race: a module read while it is being regenerated', () => {
  const HALF = 'module.exports = { generated: "half", '; // what a reader sees mid-write: not even valid JavaScript
  const FULL = 'module.exports = { generated: "full" };';
  const moduleFile = (): string => {
    seq += 1;
    return join(scratch, `client-${String(seq)}.cjs`);
  };

  it('control: without the lock, a load during the rewrite fails (the race the lock exists for)', async () => {
    const name = freshName();
    const file = moduleFile();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '60000', file, HALF, FULL], ready);

    expect(() => createRequire(file)(file) as unknown).toThrow(SyntaxError);
  });

  it('under the reader lock, a load started during the rewrite waits and sees the complete module', async () => {
    const name = freshName();
    const file = moduleFile();
    const { ready, released } = children.markers();
    await children.start(WRITER, [lockPath(name), ready, released, '400', file, HALF, FULL], ready);

    const loaded = withReadLockSync(name, () => createRequire(file)(file) as { generated: string });

    expect(loaded.generated).toBe('full');
    expect(existsSync(released)).toBe(true);
  });
});
