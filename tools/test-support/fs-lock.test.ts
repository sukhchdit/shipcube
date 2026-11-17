// Reader side of the test locks (TASK-288 = TASK-W0-FLAKE-2; D-ORCH-083, D-ORCH-098 residual, D-ARCH-137; NFR-MAINT-002).
// The writer side (`withFileLock`) predates this task and now also waits for readers of other processes. Every concurrent
// party is a real child process (tools/test-support/lock-children.ts); assertions are about ORDER, never elapsed time.
// The `@platform/prisma/client` shim on top of this lock is tested in tools/db/prisma-client-locked.test.ts.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  acquireReadLockSync,
  lockPath,
  lockRoot,
  LostTestLockError,
  OWNERLESS_STALE_MS,
  readersPath,
  takeOverStale,
  tryRegisterReader,
  withFileLock,
  withReadLock,
  withReadLockSync,
} from './fs-lock.js';
import type * as FsLockModule from './fs-lock.js';
import { deadPid, LockChildren, LockChildTimeoutError, READER, WRITER } from './lock-children.js';
import { findRepoRoot } from './process.js';

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
type FsLock = typeof FsLockModule;
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
    const stale = join(readersPath(name), `${String(await deadPid())}-${randomUUID()}`);
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

describe('PR #57 fix cycle 1: lock location, registrations, take-over and the unpinned branches', () => {
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const tombstones = (name: string): string[] => readdirSync(lockRoot()).filter((entry) => entry.startsWith(`${name}.stale-`));
  const own = (name: string, pid: number): void => {
    mkdirSync(lockPath(name));
    writeFileSync(join(lockPath(name), 'owner'), String(pid));
  };

  it('[PR57-SEC-01] every lock lives under the checkout, never in the shared temp directory', () => {
    const name = freshName();

    expect(lockRoot()).toBe(join(findRepoRoot(), 'node_modules', '.cache', 'shipqube-test-locks'));
    expect(dirname(lockPath(name))).toBe(lockRoot());
    expect(dirname(readersPath(name))).toBe(lockRoot());
  });

  it('[PR57-SEC-01] a readers path that is a link is refused before anything behind it is removed', async () => {
    const name = freshName();
    const target = mkdtempSync(join(scratch, 'victim-'));
    const victim = join(target, `${String(await deadPid())}-${randomUUID()}`);
    writeFileSync(victim, 'keep');
    symlinkSync(target, readersPath(name), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => acquireReadLockSync(name, 2_000)).toThrow(`refusing test lock readers path ${readersPath(name)}`);
    await expect(withFileLock(name, () => 'ran', 2_000)).rejects.toThrow(`refusing test lock readers path ${readersPath(name)}`);
    expect(readFileSync(victim, 'utf8')).toBe('keep');
  });

  it('[R1-m2] a registration is named <pid>-<uuid>', () => {
    const name = freshName();
    let seen: string[] = [];

    withReadLockSync(name, () => {
      seen = registrations(name);
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(new RegExp(`^${String(process.pid)}-${UUID}$`, 'u'));
  });

  it('[R1-m2] two module instances of the lock nest read locks on one name without a name collision', async () => {
    const name = freshName();
    const instances: FsLock[] = [];
    for (let i = 0; i < 2; i += 1) {
      await jest.isolateModulesAsync(async () => {
        instances.push(await import('./fs-lock.js'));
      });
    }
    const [a, b] = instances as [FsLock, FsLock];

    const value = await a.withReadLock(name, () => b.withReadLockSync(name, () => registrations(name).length, 2_000), 2_000);

    expect(value).toBe(2);
    expect(registrations(name)).toEqual([]);
  });

  it('[PR57-SEC-04] entries that are not <pid>-<uuid> registrations neither block a writer nor get removed', async () => {
    const name = freshName();
    mkdirSync(readersPath(name), { recursive: true });
    const junk = ['desktop.ini', '0-1', '-1', 'Infinity-1', `${String(children.idle())}-1`, `${String(process.pid + 1)}-0`];
    for (const entry of junk) writeFileSync(join(readersPath(name), entry), '');

    await expect(withFileLock(name, () => 'ran', 5_000)).resolves.toBe('ran');
    expect(registrations(name).sort()).toEqual([...junk].sort());
  });

  it('[PR57-SEC-04] a writer removes the empty readers directory when it lets go', async () => {
    const name = freshName();
    withReadLockSync(name, () => undefined);
    expect(existsSync(readersPath(name))).toBe(true);

    await withFileLock(name, () => undefined, 5_000);

    expect(existsSync(readersPath(name))).toBe(false);
  });

  it('[R1-n3] the readers-timeout error names the registrations that blocked the writer', async () => {
    const name = freshName();
    const { ready, released } = children.markers();
    await children.start(READER, [readersPath(name), ready, released, '60000'], ready);

    await expect(withFileLock(name, () => 'ran', 300)).rejects.toThrow(new RegExp(`: \\d+-${UUID}$`, 'u'));
  });

  it('[R1-m4 (a)] writers win ties: a writer that appears right after the registration makes the reader back off', () => {
    const name = freshName();
    const writer = children.idle();

    const release = tryRegisterReader(name, { afterRegister: () => own(name, writer) });

    expect(release).toBeUndefined();
    expect(registrations(name)).toEqual([]);
    rmSync(lockPath(name), { recursive: true, force: true });
  });

  it('[R1-m4 (b)] a writer ignores its own process readers: read-then-write in one process does not deadlock', async () => {
    const name = freshName();

    await expect(withReadLock(name, () => withFileLock(name, () => 'ran', 2_000), 2_000)).resolves.toBe('ran');
  });

  it('[R1-m1 / PR57-SEC-03] a writer whose lock was taken over fails loudly and leaves the new owner its lock', async () => {
    const name = freshName();
    const thief = children.idle();
    const steal = (): string => {
      // What a lost take-over race leaves: the directory now belongs to another live process.
      rmSync(lockPath(name), { recursive: true, force: true });
      own(name, thief);
      return 'ran';
    };

    await expect(withFileLock(name, steal, 5_000)).rejects.toThrow(LostTestLockError);
    expect(readFileSync(join(lockPath(name), 'owner'), 'utf8')).toBe(String(thief));
    rmSync(lockPath(name), { recursive: true, force: true });
  });

  it('[R1-m1 / PR57-SEC-03] a dead-owner take-over by a writer or a reader leaves no tombstone behind', async () => {
    const name = freshName();
    own(name, await deadPid());
    await expect(withFileLock(name, () => 'in', 5_000)).resolves.toBe('in');
    own(name, await deadPid());
    expect(withReadLockSync(name, () => 'in', 5_000)).toBe('in');

    expect(tombstones(name)).toEqual([]);
    expect(existsSync(lockPath(name))).toBe(false);
  });

  it('[R1-m1 / PR57-SEC-03] a take-over that catches a live lock (re-created since it was judged stale) puts it back', async () => {
    const name = freshName();
    const live = children.idle();
    own(name, live);

    takeOverStale(lockPath(name), String(await deadPid()));

    expect(readFileSync(join(lockPath(name), 'owner'), 'utf8')).toBe(String(live));
    expect(tombstones(name)).toEqual([]);
    rmSync(lockPath(name), { recursive: true, force: true });
  });

  it('[R1-n3] an ownerless writer directory blocks while fresh and is taken over once it is stale', () => {
    const name = freshName();
    mkdirSync(lockPath(name));

    expect(() => acquireReadLockSync(name, 300)).toThrow(`waiting for read lock ${lockPath(name)}`);
    const old = new Date(Date.now() - OWNERLESS_STALE_MS - 60_000);
    utimesSync(lockPath(name), old, old);
    expect(withReadLockSync(name, () => 'entered', 5_000)).toBe('entered');
  });

  it('[R1-m3] the WRITER child takes over a lock left by a dead process', async () => {
    const name = freshName();
    own(name, await deadPid());
    const { ready, released } = children.markers();

    await expect(children.start(WRITER, [lockPath(name), ready, released, '100'], ready, 30_000)).resolves.toBeUndefined();
  });

  it('[R1-m3] a lock child that cannot get ready fails with a named error instead of the Jest timeout', async () => {
    const name = freshName();
    own(name, children.idle());
    const { ready, released } = children.markers();

    const started = children.start(WRITER, [lockPath(name), ready, released, '100'], ready, 500);

    await expect(started).rejects.toThrow(LockChildTimeoutError);
    await expect(started).rejects.toThrow(`lock child could not take ${lockPath(name)} within 500 ms`);
    rmSync(lockPath(name), { recursive: true, force: true });
  });
});
