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
 * A writer exactly as `withFileLock` takes the lock (mkdir + owner pid; EEXIST = wait), so it also queues behind a real
 * prisma-tree writer. argv: lockDir, ready, released, holdMs[, file, halfText, fullText]. While holding it writes
 * `halfText` to `file`, signals `ready`, holds, writes `fullText`, writes `released` and only then removes the lock.
 */
export const WRITER = `
const fs = require('node:fs'); const path = require('node:path'); ${SLEEP}
const [dir, ready, released, holdMs, file, half, full] = process.argv.slice(1);
for (;;) { try { fs.mkdirSync(dir); break; } catch (e) { if (e.code !== 'EEXIST') throw e; sleep(50); } }
fs.writeFileSync(path.join(dir, 'owner'), String(process.pid));
if (file) fs.writeFileSync(file, half);
fs.writeFileSync(ready, '');
sleep(Number(holdMs));
if (file) fs.writeFileSync(file, full);
fs.writeFileSync(released, '');
fs.rmSync(dir, { recursive: true, force: true });
`;

/** A reader registered the way `acquireReadLockSync` registers (file `<pid>-<n>` in the readers directory). */
export const READER = `
const fs = require('node:fs'); const path = require('node:path'); ${SLEEP}
const [readers, ready, released, holdMs] = process.argv.slice(1);
fs.mkdirSync(readers, { recursive: true });
const mine = path.join(readers, process.pid + '-0');
fs.writeFileSync(mine, '');
fs.writeFileSync(ready, '');
sleep(Number(holdMs));
fs.writeFileSync(released, '');
fs.rmSync(mine, { force: true });
`;

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

  /** Runs CommonJS `script` with `args` and resolves once `ready` exists; rejects if the child exits first. */
  async start(script: string, args: readonly string[], ready: string): Promise<void> {
    const child = spawn(process.execPath, ['-e', script, '--', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (existsSync(ready)) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
      child.once('exit', (code) => {
        clearInterval(poll);
        if (existsSync(ready)) resolve();
        else reject(new Error(`lock child exited ${String(code)} before it was ready: ${stderr}`));
      });
    });
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
