/**
 * Configuration failures found while the runtime services are built (PR #9 code review R3-m1, PR #11 code review
 * R3-m2, orchestrator ruling; TASK-014). `createRuntimeServices` validates what the configuration schema cannot see
 * from the values alone: the database URL's TLS file (`sslrootcert` unreadable, a FIFO, too large) and the process
 * environment (`PGOPTIONS`). Those failures are deployment errors, so the process exits with `CONFIG_EXIT_CODE` (78)
 * after one structured log line naming the variable, never the value, the path or a stack, instead of exiting 1
 * through the fatal process-error handler. Every other error is rethrown unchanged (and reaches that handler).
 */
import { CONFIG_EXIT_CODE } from '@platform/config';

import type { RuntimeLog } from '../runtime/log.js';
import { DatabaseConfigError } from './client.js';
import { TenantTxConfigError } from './with-tenant-tx.js';

/** The variable a runtime configuration error is about, or `undefined` when `error` is not one. */
export function configErrorVariable(error: unknown): string | undefined {
  if (error instanceof DatabaseConfigError) return 'DATABASE_URL';
  if (error instanceof TenantTxConfigError) return error.variable;
  return undefined;
}

export interface ConfigExitOptions {
  readonly log: Pick<RuntimeLog, 'error'>;
  /** The flushing exit of `exitAfterFlush`: it returns before the process ends. */
  readonly exit: (code: number) => void;
}

/**
 * Runs `create`. On a runtime configuration error it logs `runtime.config_rejected` with the variable and the error
 * class, requests exit 78 and returns a promise that never settles, so the caller's top-level `await` stops there
 * while the log line is flushed and the process exits.
 */
export async function createOrExitOnConfigError<T>(create: () => T, options: ConfigExitOptions): Promise<T> {
  try {
    return create();
  } catch (error) {
    const variable = configErrorVariable(error);
    if (variable === undefined) throw error;
    options.log.error('runtime.config_rejected', { variable, error: (error as Error).name, exitCode: CONFIG_EXIT_CODE });
    options.exit(CONFIG_EXIT_CODE);
    return new Promise<T>(() => undefined);
  }
}
