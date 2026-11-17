/**
 * Separate processes that hold a test lock the way fs-lock.ts takes it, for the lock tests (TASK-288). A reader in the
 * lock owner's own process is re-entrant by design, so every concurrent party in those tests is a real child process.
 * Each child writes a `released` marker BEFORE it lets go, so a test asserts ORDER (the waiting side could only get through
 * after the marker existed), never elapsed time: the assertions hold on a loaded host.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Blocks the child for `ms` (synchronously, so nothing else it does can run first). */
const SLEEP = 'const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);';

/**
 * A writer that takes the lock as `withFileLock` does: mkdir + owner pid; on EEXIST a directory whose owner process is gone
 * is removed and the mkdir retried, a live one is waited for (PR #57 R1-m3: a lock left by a killed writer, e.g. one this
 * suite's `afterEach` killed, never wedges the next case). It does not wait for readers. argv: lockDir, ready, released,
 * holdMs[, file, halfText, fullText]. While holding it writes `halfText` to `file`, signals `ready`, holds, writes
 * `fullText`, writes `released` and only then removes the lock.
 */
export const WRITER = `
const fs = require('node:fs'); const path = require('node:path'); ${SLEEP}
const [dir, ready, released, holdMs, file, half, full] = process.argv.slice(1);
const dead = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
for (;;) {
  try { fs.mkdirSync(dir); break; } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let owner = NaN; try { owner = Number(fs.readFileSync(path.join(dir, 'owner'), 'utf8')); } catch {}
    if (Number.isInteger(owner) && owner > 0 && dead(owner)) { fs.rmSync(dir, { recursive: true, force: true }); continue; }
    sleep(50);
  }
}
fs.writeFileSync(path.join(dir, 'owner'), String(process.pid), { flag: 'wx' });
if (file) fs.writeFileSync(file, half);
fs.writeFileSync(ready, '');
sleep(Number(holdMs));
if (file) fs.writeFileSync(file, full);
fs.writeFileSync(released, '');
fs.rmSync(dir, { recursive: true, force: true });
`;

/** A reader registered the way `acquireReadLockSync` registers (file `<pid>-<uuid>` in the readers directory). */
export const READER = `
const fs = require('node:fs'); const path = require('node:path'); const { randomUUID } = require('node:crypto'); ${SLEEP}
const [readers, ready, released, holdMs] = process.argv.slice(1);
fs.mkdirSync(readers, { recursive: true });
const mine = path.join(readers, process.pid + '-' + randomUUID());
fs.writeFileSync(mine, '');
fs.writeFileSync(ready, '');
sleep(Number(holdMs));
fs.writeFileSync(released, '');
fs.rmSync(mine, { force: true });
`;

/** A process that only stays alive (a live foreign pid for owner files). */
const IDLE = 'setInterval(() => undefined, 1_000);';

/** Default readiness deadline of {@link LockChildren.start}: a hang detector, never a latency target. */
export const LOCK_CHILD_READY_MS = 60_000;

/** Rejected by {@link LockChildren.start} when the child is not ready within its deadline. */
export class LockChildTimeoutError extends Error {
  override readonly name = 'LockChildTimeoutError';
}

/** Starts lock-holding children and kills whatever is still running on {@link LockChildren.killAll}. */
export class LockChildren {
  private readonly children: ChildProcess[] = [];
  private seq = 0;

  constructor(private readonly scratch: string) {}

  /** Fresh `ready` / `released` marker paths. */
  markers(): { ready: string; released: string } {
    this.seq += 1;
    const id = String(this.seq);
    return { ready: join(this.scratch, `ready-${id}`), released: join(this.scratch, `released-${id}`) };
  }

  /**
   * Runs CommonJS `script` with `args` and resolves once `ready` exists. Rejects if the child exits first, or with
   * {@link LockChildTimeoutError} naming `args[0]` (the lock it was asked to take) if it is not ready within `readyMs`.
   */
  async start(script: string, args: readonly string[], ready: string, readyMs = LOCK_CHILD_READY_MS): Promise<void> {
    const child = spawn(process.execPath, ['-e', script, '--', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error): void => {
        clearInterval(poll);
        clearTimeout(deadline);
        if (error === undefined) resolve();
        else reject(error);
      };
      const poll = setInterval(() => {
        if (existsSync(ready)) finish();
      }, 10);
      const deadline = setTimeout(() => {
        child.kill();
        finish(new LockChildTimeoutError(`lock child could not take ${String(args[0])} within ${String(readyMs)} ms`));
      }, readyMs);
      child.once('exit', (code) => {
        if (existsSync(ready)) finish();
        else finish(new Error(`lock child exited ${String(code)} before it was ready: ${stderr}`));
      });
    });
  }

  /**
   * Starts a process that only stays alive and returns its pid (killed by {@link killAll}). With `cwd`, the process runs in
   * that directory (on Windows a directory that is a live process's cwd cannot be renamed).
   */
  idle(cwd?: string): number {
    const child = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true, ...(cwd === undefined ? {} : { cwd }) });
    this.children.push(child);
    if (child.pid === undefined) throw new Error('idle: the child got no pid');
    return child.pid;
  }

  /**
   * Like {@link idle}, but runs in `cwd` and resolves only once the child is running (it writes a marker from inside). On
   * Windows the directory is then in use as its cwd; the `spawn` event alone fires before that (PR #57 fix cycle 2).
   */
  async idleStarted(cwd: string): Promise<number> {
    const { ready } = this.markers();
    const script = `require('node:fs').writeFileSync(process.argv[1], ''); ${IDLE}`;
    const child = spawn(process.execPath, ['-e', script, '--', ready], { stdio: 'ignore', windowsHide: true, cwd });
    this.children.push(child);
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
      child.once('exit', (code) => {
        clearInterval(poll);
        reject(new Error(`idle child exited ${String(code)} before it was ready`));
      });
    });
    if (child.pid === undefined) throw new Error('idleStarted: the child got no pid');
    return child.pid;
  }

  killAll(): void {
    for (const child of this.children.splice(0)) child.kill();
  }
}

/** A pid that is certainly not running: a child that has already exited. */
export async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
  await new Promise((resolve) => child.once('exit', resolve));
  if (child.pid === undefined) throw new Error('deadPid: the probe child got no pid');
  return child.pid;
}
