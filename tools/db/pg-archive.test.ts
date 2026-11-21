/**
 * The archive tool of the restore rehearsal (data-model.md §8.6 steps 2 and 4; TASK-034): the `docker compose exec`
 * argument lists, the name checks that keep `--dbname` a plain name, the masked error line and the process runner
 * (run here with Node itself; the pg_dump/pg_restore run is prisma/tests/migrations/backup-restore.int.test.ts).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  ARCHIVE_TIMEOUT_MS,
  CONTAINER_GRACE_MS,
  checkDatabaseName,
  checkSnapshotId,
  composeArchiveTool,
  createProcessRunner,
  errorSummary,
  runProcess,
  type ProcessRequest,
  type ProcessResult,
} from './pg-archive.js';
import { RehearsalError } from './rehearsal-manifest.js';

/** Yields once, as a real database or process call would. */
const tick = (): Promise<void> => Promise.resolve();

const work = mkdtempSync(join(tmpdir(), 'pg-archive-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const SNAPSHOT = '00000003-0000001B-1';

function recorder(result: Partial<ProcessResult> = {}) {
  const requests: ProcessRequest[] = [];
  const run = async (request: ProcessRequest): Promise<ProcessResult> => {
    await tick();
    requests.push(request);
    return { code: 0, stdout: 'CREATE TABLE x ();', stderr: '', timedOut: false, ...result };
  };
  return { requests, run };
}

describe('composeArchiveTool', () => {
  it('runs pg_dump, pg_dump --schema-only and pg_restore in the postgres service over its socket, without a shell or a password, under an in-container timeout', async () => {
    const { requests, run } = recorder();
    const tool = composeArchiveTool({ run, timeoutMs: 1000 });
    await tool.dump({ database: 'platform', snapshot: SNAPSHOT, archive: join(work, 'a.dump') });
    expect(await tool.dumpSchema({ database: 'platform', snapshot: SNAPSHOT })).toBe('CREATE TABLE x ();');
    await tool.dumpSchema({ database: 'rehearsal_x' });
    await tool.restore({ database: 'rehearsal_x', archive: join(work, 'a.dump') });
    expect(requests.map((request) => [request.command, ...request.args].join(' '))).toEqual([
      `docker compose exec -T postgres timeout -k 10 1 pg_dump --format=custom --username postgres --dbname platform --snapshot ${SNAPSHOT}`,
      `docker compose exec -T postgres timeout -k 10 1 pg_dump --schema-only --username postgres --dbname platform --snapshot ${SNAPSHOT}`,
      'docker compose exec -T postgres timeout -k 10 1 pg_dump --schema-only --username postgres --dbname rehearsal_x',
      'docker compose exec -T postgres timeout -k 10 1 pg_restore --exit-on-error --username postgres --dbname rehearsal_x',
    ]);
    expect(requests[0]?.stdoutFile).toBe(join(work, 'a.dump'));
    expect(requests[3]?.stdinFile).toBe(join(work, 'a.dump'));
    // The host waits past the in-container limit, so the timeout stops the tool inside the container first (R1-n7).
    expect(requests.every((request) => request.timeoutMs === 1000 + CONTAINER_GRACE_MS)).toBe(true);
  });

  it('takes another service, role, Compose project and compose arguments (after compose, before exec)', async () => {
    const { requests, run } = recorder();
    await composeArchiveTool({ run, service: 'db-1', user: 'admin', project: 'shipqube', composeArgs: ['--ansi', 'never'] }).restore({
      database: 'x',
      archive: 'f',
    });
    expect(requests[0]?.args).toEqual([
      'compose',
      '-p',
      'shipqube',
      '--ansi',
      'never',
      'exec',
      '-T',
      'db-1',
      'timeout',
      '-k',
      '10',
      String(ARCHIVE_TIMEOUT_MS / 1000),
      'pg_restore',
      '--exit-on-error',
      '--username',
      'admin',
      '--dbname',
      'x',
    ]);
  });

  it('refuses a service or role name that is not plain, and a database or snapshot that pg_dump could read as something else', async () => {
    expect(() => composeArchiveTool({ service: 'pg --rm' })).toThrow(RehearsalError);
    expect(() => composeArchiveTool({ user: 'Admin' })).toThrow(RehearsalError);
    for (const project of ['-p', 'Ship', 'a b', '']) expect(() => composeArchiveTool({ project })).toThrow(/Compose project name/);
    const tool = composeArchiveTool({ run: recorder().run });
    await expect(tool.dump({ database: 'host=evil dbname=x', snapshot: SNAPSHOT, archive: 'f' })).rejects.toThrow(
      /plain lower-case identifier/,
    );
    await expect(tool.dump({ database: 'platform', snapshot: '--help', archive: 'f' })).rejects.toThrow(/snapshot id/);
    expect(checkDatabaseName('platform')).toBe('platform');
    for (const name of ['postgresql://x', 'a=b', 'Platform', '', 'x'.repeat(64)])
      expect(() => checkDatabaseName(name)).toThrow(RehearsalError);
    expect(checkSnapshotId(SNAPSHOT)).toBe(SNAPSHOT);
  });

  it('turns a failure into one masked line: exit code or timeout, the first error line, quoted values replaced', async () => {
    const failing = composeArchiveTool({
      run: recorder({
        code: 1,
        stderr:
          'pg_restore: processing data\npg_restore: error: COPY failed for table "users": ERROR: invalid input \'alice@example.com\'\nmore',
      }).run,
    });
    await expect(failing.restore({ database: 'x', archive: 'f' })).rejects.toThrow(
      /^pg_restore exited with 1: pg_restore: error: COPY failed for table "…": ERROR: invalid input '…'$/,
    );
    const slow = composeArchiveTool({ timeoutMs: 5, run: recorder({ code: null, timedOut: true, stderr: '' }).run });
    await expect(slow.dumpSchema({ database: 'x' })).rejects.toThrow(/^pg_dump --schema-only timed out after 30005 ms: no error line$/);
    const inContainer = composeArchiveTool({ timeoutMs: 2500, run: recorder({ code: 124, stderr: '' }).run });
    await expect(inContainer.restore({ database: 'x', archive: 'f' })).rejects.toThrow(
      /^pg_restore timed out in the container after 3 s: no error line$/,
    );
    expect(errorSummary(`error: ${'x'.repeat(500)}`)).toHaveLength(200);
  });
});

describe('runProcess (no shell, bounded, never rejects)', () => {
  const node = (script: string, extra: Partial<ProcessRequest> = {}): Promise<ProcessResult> =>
    runProcess({ command: process.execPath, args: ['-e', script], timeoutMs: 20_000, ...extra });

  it('captures stdout and stderr and the exit code', async () => {
    const result = await node("process.stdout.write('out'); process.stderr.write('err'); process.exit(3)");
    expect(result).toEqual({ code: 3, stdout: 'out', stderr: 'err', timedOut: false });
  });

  it('streams stdout into a new file and stdin from a file', async () => {
    const input = join(work, 'in.bin');
    writeFileSync(input, Buffer.from([0, 1, 2, 255]));
    const output = join(work, 'out.bin');
    const result = await node('process.stdin.pipe(process.stdout)', { stdinFile: input, stdoutFile: output });
    expect(result.code).toBe(0);
    expect([...readFileSync(output)]).toEqual([0, 1, 2, 255]);
    // The output file is never overwritten ('wx').
    const again = await node("process.stdout.write('x')", { stdoutFile: output });
    expect(again.code).toBeNull();
    expect(again.stderr).toMatch(/could not write the output file \(EEXIST\)/);
  });

  it('kills a process at the timeout and reports it', async () => {
    const result = await node('setTimeout(() => {}, 60000)', { timeoutMs: 200 });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
  });

  it('stops a process whose stdout exceeds the capture limit, and reports a missing input file and a missing command', async () => {
    const big = await node("process.stdout.write('y'.repeat(4096)); setTimeout(() => {}, 60000)", { maxCapture: 1024 });
    expect(big.code).toBeNull();
    expect(big.stderr).toMatch(/stdout exceeded 1024 bytes/);
    const missing = await node('process.stdin.resume()', { stdinFile: join(work, 'missing.bin') });
    expect(missing.code).toBeNull();
    expect(missing.stderr).toMatch(/could not read the input file \(ENOENT\)/);
    const absent = await runProcess({ command: join(work, 'no-such-tool'), args: [], timeoutMs: 5000 });
    expect(absent.code).toBeNull();
    expect(absent.stderr).toMatch(/^error: could not start .*no-such-tool \(ENOENT\)$/);
  });

  describe('[TASK-034 R1-m3] the archive file is complete, or the run fails, when the result settles', () => {
    const script = "process.stdout.write('z'.repeat(70000))";
    const request = (path: string): ProcessRequest => ({
      command: process.execPath,
      args: ['-e', script],
      timeoutMs: 20_000,
      stdoutFile: path,
    });

    it('settles only after a slow sink has flushed every byte', async () => {
      const written: Buffer[] = [];
      let finished = false;
      const slow = () =>
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            written.push(chunk);
            setTimeout(done, 5);
          },
          final(done) {
            setTimeout(() => {
              finished = true;
              done();
            }, 50);
          },
        });
      const result = await createProcessRunner(slow)(request('unused'));
      expect(result.code).toBe(0);
      expect(finished).toBe(true);
      expect(Buffer.concat(written).length).toBe(70000);
    });

    it('fails the run on a write error at the final flush (ENOSPC), after the process exited 0', async () => {
      const full = () =>
        new Writable({
          write(_chunk: Buffer, _encoding, done) {
            done();
          },
          final(done) {
            setTimeout(() => done(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })), 50);
          },
        });
      const result = await createProcessRunner(full)(request('unused'));
      expect(result.code).toBeNull();
      expect(result.stderr).toMatch(/could not write the output file \(ENOSPC\)$/);
    });

    it('writes the real file completely before it settles', async () => {
      const path = join(work, 'complete.bin');
      expect((await runProcess(request(path))).code).toBe(0);
      expect(readFileSync(path)).toHaveLength(70000);
    });
  });
});
