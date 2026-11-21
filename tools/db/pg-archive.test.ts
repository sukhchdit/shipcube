/**
 * The archive tool of the restore rehearsal (data-model.md §8.6 steps 2 and 4; TASK-034): the `docker compose exec`
 * argument lists, the name checks that keep `--dbname` a plain name, the masked error line and the process runner
 * (run here with Node itself; the pg_dump/pg_restore run is prisma/tests/migrations/backup-restore.int.test.ts).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import {
  checkDatabaseName,
  checkSnapshotId,
  composeArchiveTool,
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
  it('runs pg_dump, pg_dump --schema-only and pg_restore in the postgres service over its socket, without a shell or a password', async () => {
    const { requests, run } = recorder();
    const tool = composeArchiveTool({ run, timeoutMs: 1000 });
    await tool.dump({ database: 'platform', snapshot: SNAPSHOT, archive: join(work, 'a.dump') });
    expect(await tool.dumpSchema({ database: 'platform', snapshot: SNAPSHOT })).toBe('CREATE TABLE x ();');
    await tool.dumpSchema({ database: 'rehearsal_x' });
    await tool.restore({ database: 'rehearsal_x', archive: join(work, 'a.dump') });
    expect(requests.map((request) => [request.command, ...request.args].join(' '))).toEqual([
      `docker compose exec -T postgres pg_dump --format=custom --username postgres --dbname platform --snapshot ${SNAPSHOT}`,
      `docker compose exec -T postgres pg_dump --schema-only --username postgres --dbname platform --snapshot ${SNAPSHOT}`,
      'docker compose exec -T postgres pg_dump --schema-only --username postgres --dbname rehearsal_x',
      'docker compose exec -T postgres pg_restore --exit-on-error --username postgres --dbname rehearsal_x',
    ]);
    expect(requests[0]?.stdoutFile).toBe(join(work, 'a.dump'));
    expect(requests[3]?.stdinFile).toBe(join(work, 'a.dump'));
    expect(requests.every((request) => request.timeoutMs === 1000)).toBe(true);
  });

  it('takes another service, role and compose arguments', async () => {
    const { requests, run } = recorder();
    await composeArchiveTool({ run, service: 'db-1', user: 'admin', composeArgs: ['-p', 'restore'] }).restore({
      database: 'x',
      archive: 'f',
    });
    expect(requests[0]?.args).toEqual([
      '-p',
      'restore',
      'compose',
      'exec',
      '-T',
      'db-1',
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
    await expect(slow.dumpSchema({ database: 'x' })).rejects.toThrow(/^pg_dump --schema-only timed out after 5 ms: no error line$/);
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
});
