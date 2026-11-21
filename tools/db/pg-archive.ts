/**
 * `pg_dump` / `pg_restore` for the restore rehearsal (data-model.md §8.6 steps 2 and 4; TASK-034), behind one port so
 * the drivers (backup.ts, verify-restore.ts) are I/O-agnostic: the Testcontainers suite runs the tools with
 * `container.exec`, the CLI runs them in the Compose `postgres` service through `docker compose exec -T`, so the
 * Windows host needs no PostgreSQL client and no password is put on a command line (the container's superuser connects
 * over the local socket). The archive file stays on the host: `pg_dump` writes to stdout, `pg_restore` reads stdin.
 *
 * Every argument is passed as an array element (never through a shell). Database names are checked against
 * `DATABASE_NAME` first, because `pg_dump --dbname` treats a value with `=` or a URI prefix as a connection string.
 * Error messages carry the exit code and the tool's first error line without the server's message text, with every
 * quoted fragment and parenthesised group masked (a COPY, a constraint error or a RAISE can carry row data;
 * PR034-SEC-03), never the full stderr. The archive is created owner-only, `0o600` (PR034-SEC-02).
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import type { Writable } from 'node:stream';

import { PRIVATE_FILES } from './private-files.js';
import { maskValues } from './prisma-outcome.js';
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

/** The start of a server message inside a client tool's line (`… could not execute query: ERROR:  …`). */
const SERVER_MESSAGE = /\b(?:ERROR|FATAL|PANIC):\s*/;

/**
 * The first `pg_dump:`/`pg_restore:` error line, at most 200 characters (PR034-SEC-03). The server's message text is
 * dropped (`ERROR: …`): a `RAISE` during COPY carries whatever value its author put there, unquoted. The rest of the line
 * has every quoted fragment and parenthesised group masked (`maskValues`), and the DETAIL / CONTEXT lines that follow are
 * never read.
 */
export function errorSummary(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((candidate) => /\berror:/i.test(candidate));
  if (line === undefined) return 'no error line';
  const server = SERVER_MESSAGE.exec(line);
  const clientPart = server === null ? line : line.slice(0, server.index);
  const kept = maskValues(clientPart.trim());
  return (server === null ? kept : `${kept}${kept === '' ? '' : ' '}${server[0].trim()} …`).slice(0, 200);
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

/** Opens the stdout file (`wx`: a backup is never written over another; `0o600`: owner only, PR034-SEC-02). */
export type SinkFactory = (path: string) => Writable;
const newFileSink: SinkFactory = (path) => PRIVATE_FILES.openSink(path);

/**
 * A process runner without a shell, with a hard timeout and bounded capture; never rejects. With `stdoutFile` it settles
 * only once the file sink has finished (or failed) after the process closed, so a write error at the final flush
 * (ENOSPC) fails the run instead of being lost after it settled (TASK-034 code review R1-m3).
 */
export const createProcessRunner =
  (openSink: SinkFactory = newFileSink): ProcessRunner =>
  (request) =>
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
      let sink: Writable | undefined;
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
        sink = openSink(request.stdoutFile);
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
        sink?.destroy();
        resolve({
          code: null,
          stdout: '',
          stderr: `error: could not start ${request.command} (${(error as NodeJS.ErrnoException).code ?? 'EIO'})`,
          timedOut,
        });
      });
      const settle = (code: number | null): void => {
        const tail = failure === undefined ? '' : `\nerror: ${failure}`;
        resolve({
          code: failure === undefined ? code : null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8') + tail,
          timedOut,
        });
      };
      child.on('close', (code) => {
        clearTimeout(timer);
        const file = sink;
        // The pipe ends the sink when stdout ends; 'close' follows its 'finish' or its 'error' (autoDestroy).
        if (file === undefined || file.closed) settle(code);
        else file.once('close', () => settle(code));
      });
    });

export const runProcess: ProcessRunner = createProcessRunner();

export interface ComposeArchiveOptions {
  /** Compose service running PostgreSQL (default `postgres`). */
  readonly service?: string;
  /** Role the tools connect as over the container's socket (the bootstrap superuser, default `postgres`). */
  readonly user?: string;
  /**
   * Compose project (`docker compose -p <project>`). Without it Compose derives the project from the working
   * directory, so a run from a task worktree (`../Shipqube-TASK-xxx`) talks to that worktree's stack (R1-n8).
   */
  readonly project?: string;
  /** Extra `docker compose` arguments, after `compose` and before `exec`. */
  readonly composeArgs?: readonly string[];
  readonly timeoutMs?: number;
  readonly run?: ProcessRunner;
}

const SERVICE_NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
/** A Compose project name (lower-case letters, digits, `_` and `-`, starting with a letter or digit). */
const PROJECT_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
export const ARCHIVE_TIMEOUT_MS = 60 * 60_000;
/**
 * Extra time the host waits past the in-container `timeout`: TERM at the limit, KILL 10 s later, then the exec ends.
 * Killing the `docker` client alone would leave `pg_dump` / `pg_restore` running in the container (R1-n7).
 */
export const CONTAINER_GRACE_MS = 30_000;
/** `timeout`'s exit code when TERM at the limit stopped the tool (137, after the KILL of `-k`, could also be an OOM kill). */
const CONTAINER_TIMEOUT_EXIT = 124;

/** The archive tool over `docker compose exec -T <service>` (the local Compose stack, platform.md §2). */
export function composeArchiveTool(options: ComposeArchiveOptions = {}): ArchiveTool {
  const service = options.service ?? 'postgres';
  const user = options.user ?? 'postgres';
  if (!SERVICE_NAME.test(service)) throw new RehearsalError('the Compose service name has an unexpected form');
  if (options.project !== undefined && !PROJECT_NAME.test(options.project)) {
    throw new RehearsalError('the Compose project name has an unexpected form');
  }
  if (!ROLE_NAME.test(user)) throw new RehearsalError('the dump role name must be a plain lower-case identifier');
  const run = options.run ?? runProcess;
  const timeoutMs = options.timeoutMs ?? ARCHIVE_TIMEOUT_MS;
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const exec = (tool: string, args: readonly string[]) => [
    'compose',
    ...(options.project === undefined ? [] : ['-p', options.project]),
    ...(options.composeArgs ?? []),
    'exec',
    '-T',
    service,
    'timeout',
    '-k',
    '10',
    String(seconds),
    tool,
    ...args,
  ];
  const checked = async (tool: string, request: Omit<ProcessRequest, 'command' | 'timeoutMs'>): Promise<ProcessResult> => {
    const result = await run({ command: 'docker', timeoutMs: timeoutMs + CONTAINER_GRACE_MS, ...request });
    if (result.code !== 0) {
      const reason = result.timedOut
        ? `timed out after ${String(timeoutMs + CONTAINER_GRACE_MS)} ms`
        : result.code === CONTAINER_TIMEOUT_EXIT
          ? `timed out in the container after ${String(seconds)} s`
          : `exited with ${String(result.code)}`;
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
