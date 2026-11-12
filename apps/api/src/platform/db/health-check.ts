/**
 * Readiness check of PostgreSQL (US-012): `SELECT 1` through the runtime `pg` pool, then the session-integrity guard
 * when one is given (PR7-SEC-06 item 3: role-setting drift or a preset tenant context makes the database not ready).
 * The pool's `connectionTimeoutMillis` and `query_timeout` bound it on the driver side; the readiness runner bounds it
 * at 2 s regardless (`evaluateReadiness`). pg queries are not abortable, so the signal is only checked before start.
 */
import type { ReadinessCheck } from '../runtime/readiness.js';
import type { SessionIntegrityGuard } from './session-integrity.js';

/** The part of `pg.Pool` the check uses. */
export interface QueryablePool {
  query(text: string): Promise<unknown>;
}

export function createDatabaseCheck(pool: QueryablePool, integrity?: SessionIntegrityGuard): ReadinessCheck {
  return Object.freeze({
    name: 'database' as const,
    critical: true,
    async check(signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      await pool.query('SELECT 1');
      if (integrity !== undefined) await integrity.assertIntact();
    },
  });
}
