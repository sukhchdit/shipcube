/**
 * `pg_dump` / `pg_restore` for the restore rehearsal (data-model.md §8.6 steps 2 and 4; TASK-034), behind one port so
 * the drivers (backup.ts, verify-restore.ts) are I/O-agnostic: the Testcontainers suite runs the tools with
 * `container.exec`, the CLI runs them in the Compose `postgres` service through `docker compose exec -T`, so the
 * Windows host needs no PostgreSQL client and no password is put on a command line (the container's superuser connects
 * over the local socket). The archive file stays on the host: `pg_dump` writes to stdout, `pg_restore` reads stdin.
 *
 * Every argument is passed as an array element (never through a shell). Database names are checked against
 * `DATABASE_NAME` first, because `pg_dump --dbname` treats a value with `=` or a URI prefix as a connection string.
 * Error messages carry the exit code and the tool's first error line with every quoted fragment masked (a COPY or a
 * constraint error can quote row data), never the full stderr.
 */
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';

import { RehearsalError } from './rehearsal-manifest.js';

export interface ArchiveTool {
  /** `pg_dump --format=custom` of `database` under the exported `snapshot`, into the archive `archive`. */
  dump(request: { readonly database: string; readonly snapshot: string; readonly archive: string }): Promise<void>;
  /** `pg_dump --schema-only` text of `database` (under `snapshot` when given). */
  dumpSchema(request: { readonly database: string; readonly snapshot?: string }): Promise<string>;
  /** `pg_restore --exit-on-error` of `archive` into the existing, empty `database`. */
  restore(request: { readonly database: string; readonly archive: string }): Promise<void>;
}

/** An unquoted PostgreSQL identifier a tool may take as a plain database name (lower case, at most 63 bytes). */
export const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
/** An exported snapshot id (`pg_export_snapshot()`: hex groups joined by `-`). */
const SNAPSHOT_ID = /^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{1,8}$/i;

export function checkDatabaseName(database: string): string {
  if (!DATABASE_NAME.test(database)) {
    throw new RehearsalError('the database name must be a plain lower-case identifier ([a-z_][a-z0-9_]*, at most 63 characters)');
  }
  return database;
}

export function checkSnapshotId(snapshot: string): string {
  if (!SNAPSHOT_ID.test(snapshot)) throw new RehearsalError('the exported snapshot id has an unexpected form');
  return snapshot;
}

/** The first `pg_dump:`/`pg_restore:` error line, quoted fragments masked, at most 200 characters. */
export function errorSummary(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((candidate) => /\berror:/i.test(candidate));
  if (line === undefined) return 'no error line';
  return line
    .trim()
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'")
    .slice(0, 200);
}

export interface ProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  /** Host file streamed to stdin. */
  readonly stdinFile?: string;
  /** Host file stdout is streamed to (else stdout is captured, up to `maxCapture` bytes). */
  readonly stdoutFile?: string;
  readonly timeoutMs: number;
  readonly maxCapture?: number;
}

export interface ProcessResult {
  /** Exit code; null when the process was killed (timeout) or did not start. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type ProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>;

const DEFAULT_CAPTURE = 64 * 1024 * 1024;
const STDERR_CAPTURE = 256 * 1024;

/** Runs a process without a shell, with a hard timeout and bounded capture; never rejects. */
export const runProcess: ProcessRunner = (request) =>
  new Promise((resolve) => {
    const child = spawn(request.command, [...request.args], {
      stdio: [request.stdinFile === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    const { stdout: out, stderr: err } = child;
    if (out === null || err === null) {
      child.kill('SIGKILL');
      resolve({ code: null, stdout: '', stderr: 'error: no output pipes', timedOut: false });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let failure: string | undefined;
    const limit = request.maxCapture ?? DEFAULT_CAPTURE;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, request.timeoutMs);
    const fail = (message: string): void => {
      failure ??= message;
      child.kill('SIGKILL');
    };
    if (request.stdoutFile === undefined) {
      out.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > limit) fail(`stdout exceeded ${String(limit)} bytes`);
        else stdout.push(chunk);
      });
    } else {
      const sink = createWriteStream(request.stdoutFile, { flags: 'wx' });
      sink.on('error', (error) => fail(`could not write the output file (${(error as NodeJS.ErrnoException).code ?? 'EIO'})`));
      out.pipe(sink);
    }
    err.on('data', (chunk: Buffer) => {
      if (stderrBytes < STDERR_CAPTURE) stderr.push(chunk);
      stderrBytes += chunk.length;
    });
    if (request.stdinFile !== undefined && child.stdin !== null) {
      const source = createReadStream(request.stdinFile);
      source.on('error', (error) => fail(`could not read the input file (${(error as NodeJS.ErrnoException).code ?? 'EIO'})`));
      child.stdin.on('error', () => undefined); // EPIPE when the tool exits early; its exit code reports the failure
      source.pipe(child.stdin);
    }
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout: '',
        stderr: `error: could not start ${request.command} (${(error as NodeJS.ErrnoException).code ?? 'EIO'})`,
        timedOut,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const tail = failure === undefined ? '' : `\nerror: ${failure}`;
      resolve({
        code: failure === undefined ? code : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') + tail,
        timedOut,
      });
    });
  });

export interface ComposeArchiveOptions {
  /** Compose service running PostgreSQL (default `postgres`). */
  readonly service?: string;
  /** Role the tools connect as over the container's socket (the bootstrap superuser, default `postgres`). */
  readonly user?: string;
  /** Extra `docker compose` arguments before `exec` (e.g. `-p <project>`). */
  readonly composeArgs?: readonly string[];
  readonly timeoutMs?: number;
  readonly run?: ProcessRunner;
}

const SERVICE_NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
export const ARCHIVE_TIMEOUT_MS = 60 * 60_000;

/** The archive tool over `docker compose exec -T <service>` (the local Compose stack, platform.md §2). */
export function composeArchiveTool(options: ComposeArchiveOptions = {}): ArchiveTool {
  const service = options.service ?? 'postgres';
  const user = options.user ?? 'postgres';
  if (!SERVICE_NAME.test(service)) throw new RehearsalError('the Compose service name has an unexpected form');
  if (!ROLE_NAME.test(user)) throw new RehearsalError('the dump role name must be a plain lower-case identifier');
  const run = options.run ?? runProcess;
  const timeoutMs = options.timeoutMs ?? ARCHIVE_TIMEOUT_MS;
  const exec = (tool: string, args: readonly string[]) => [...(options.composeArgs ?? []), 'compose', 'exec', '-T', service, tool, ...args];
  const checked = async (tool: string, request: Omit<ProcessRequest, 'command' | 'timeoutMs'>): Promise<ProcessResult> => {
    const result = await run({ command: 'docker', timeoutMs, ...request });
    if (result.code !== 0) {
      const reason = result.timedOut ? `timed out after ${String(timeoutMs)} ms` : `exited with ${String(result.code)}`;
      throw new RehearsalError(`${tool} ${reason}: ${errorSummary(result.stderr)}`);
    }
    return result;
  };
  return {
    async dump({ database, snapshot, archive }) {
      const args = [
        '--format=custom',
        '--username',
        user,
        '--dbname',
        checkDatabaseName(database),
        '--snapshot',
        checkSnapshotId(snapshot),
      ];
      await checked('pg_dump', { args: exec('pg_dump', args), stdoutFile: archive });
    },
    async dumpSchema({ database, snapshot }) {
      const args = ['--schema-only', '--username', user, '--dbname', checkDatabaseName(database)];
      if (snapshot !== undefined) args.push('--snapshot', checkSnapshotId(snapshot));
      return (await checked('pg_dump --schema-only', { args: exec('pg_dump', args) })).stdout;
    },
    async restore({ database, archive }) {
      const args = ['--exit-on-error', '--username', user, '--dbname', checkDatabaseName(database)];
      await checked('pg_restore', { args: exec('pg_restore', args), stdinFile: archive });
    },
  };
}
