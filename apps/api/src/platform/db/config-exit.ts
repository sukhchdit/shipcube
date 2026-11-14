/**
 * Configuration failures found while the runtime services are built (PR #9 code review R3-m1, PR #11 code review
 * R3-m2, orchestrator ruling; TASK-014). `createRuntimeServices` validates what the configuration schema cannot see
 * from the values alone: the database URL's TLS file (`sslrootcert` unreadable, a FIFO, too large) and the process
 * environment (`PGOPTIONS`). Those failures are deployment errors. Both entry points call `createRuntimeServices` at
 * the top level below `installProcessErrorHandlers`, so the throw is an uncaught exception, and the handler
 * (runtime/process-errors.ts) logs `runtime.config_rejected` naming the variable (never the value, the path or a stack)
 * and exits with `CONFIG_EXIT_CODE` (78) instead of 1 (D-TASK014-24).
 */
import { DatabaseConfigError } from '@platform/config';

import { TenantTxConfigError } from './with-tenant-tx.js';

/** The variable a runtime configuration error is about, or `undefined` when `error` is not one. */
export function configErrorVariable(error: unknown): string | undefined {
  if (error instanceof DatabaseConfigError) return 'DATABASE_URL';
  if (error instanceof TenantTxConfigError) return error.variable;
  return undefined;
}
