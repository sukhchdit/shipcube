// Process-level error handlers of the api and the worker (PR20-SEC-06, US-008, NFR-PRIV-001; TASK-010). Without them
// Node prints `util.inspect(error)` of an uncaught exception or unhandled rejection to stderr: every own property,
// including a Prisma error's `meta.driverAdapterError` with PostgreSQL's message and `detail`, bypassing the redactor.
// These handlers write ONE fatal line through the platform logger instead (database errors as { name, code,
// originalCode, kind } only, other errors with redacted message and stack) and keep crash-only semantics: exit code 1.
import type { PlatformLogger } from '@platform/shared/logging';

/** The `process` events used here (an EventEmitter in tests). */
export interface ProcessErrorSource {
  on(event: 'uncaughtException', listener: (error: unknown, origin: unknown) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface ProcessErrorHandlerOptions {
  readonly log: Pick<PlatformLogger, 'fatal'>;
  /** Called once, with 1: `exitAfterFlush({ stream: process.stdout, exit: ... })` in the entry points. */
  readonly exit: (code: number) => void;
  /** Default `process`. */
  readonly source?: ProcessErrorSource;
}

const ORIGINS: ReadonlySet<unknown> = new Set(['uncaughtException', 'unhandledRejection']);

/** The part of a writable stream the flush needs (`process.stdout`). */
export interface FlushableStream {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

export interface ExitAfterFlushOptions {
  /** The stream the logger writes to (`process.stdout`). */
  readonly stream: FlushableStream;
  /** `process.exit`. */
  readonly exit: (code: number) => void;
  /** Exit anyway after this long when the stream never calls back (a broken pipe); default 1000 ms. */
  readonly timeoutMs?: number;
  /** Default `setTimeout` (tests). */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
}

/**
 * An `exit` for installProcessErrorHandlers that lets the fatal line reach the stream first (PR #20 R2-n7). stdout is
 * synchronous for files and pipes on Linux, but a pipe is asynchronous on Windows, where `process.exit` straight after
 * the write can drop the line. This writes an empty chunk, whose callback runs once the earlier chunks are flushed,
 * and exits from that callback; a timer exits anyway if the stream never calls back. Exits once.
 */
export function exitAfterFlush(options: ExitAfterFlushOptions): (code: number) => void {
  const setTimer = options.setTimer ?? setTimeout;
  return (code) => {
    let exited = false;
    const exitOnce = (): void => {
      if (exited) return;
      exited = true;
      options.exit(code);
    };
    setTimer(exitOnce, options.timeoutMs ?? 1000);
    try {
      options.stream.write('', exitOnce);
    } catch {
      // A destroyed stream throws synchronously: nothing more can be flushed, so exit now.
      exitOnce();
    }
  };
}

/** Registers the handlers; the process exits with 1 after the first fatal line (crash-only, never resumes). */
export function installProcessErrorHandlers(options: ProcessErrorHandlerOptions): void {
  const source = options.source ?? process;
  let exiting = false;
  const crash = (event: string, fields: Readonly<Record<string, string>>, thrown: unknown): void => {
    try {
      options.log.fatal(event, fields, thrown);
    } finally {
      if (!exiting) {
        exiting = true;
        options.exit(1);
      }
    }
  };
  source.on('uncaughtException', (error, origin) =>
    crash('process.uncaught_exception', ORIGINS.has(origin) ? { origin: String(origin) } : {}, error),
  );
  source.on('unhandledRejection', (reason) => crash('process.unhandled_rejection', {}, reason));
}
