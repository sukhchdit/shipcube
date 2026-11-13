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
  /** `process.exit`; called once, with 1. */
  readonly exit: (code: number) => void;
  /** Default `process`. */
  readonly source?: ProcessErrorSource;
}

const ORIGINS: ReadonlySet<unknown> = new Set(['uncaughtException', 'unhandledRejection']);

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
