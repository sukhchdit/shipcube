/**
 * Session-integrity guard of the runtime role (PR7-SEC-06 item 3, PR7-SEC-02 item 2; D-ORCH-011). Two persistent
 * tampering paths would silently weaken every new connection of the pool:
 *  - `platform_app` may `ALTER ROLE platform_app SET|RESET` its own USERSET defaults (`lock_timeout`,
 *    `idle_in_transaction_session_timeout`, `search_path`, `statement_timeout`, `default_transaction_read_only`),
 *    which then apply to every API and worker task and survive restarts;
 *  - a session default for a tenant-context key (`app.org_id`, ...) would pre-set RLS context on fresh connections.
 * The guard compares the role and database-level settings that apply to `current_user` with the exact expected set
 * from the bootstrap lane (`prisma/bootstrap/*.sql`), and requires every tenant-context key to be unset.
 *
 * Fresh versus pooled (PR-0009 code review M1): a pooled connection on which a transaction-local `set_config` ran
 * reports '' for that key afterwards (ADR-0005 item 16, F-07), so only a connection opened for the check can prove
 * "no session default". The start-up check therefore runs at boot on a DEDICATED new connection (never a pooled one)
 * and requires NULL; until it has passed, every check uses a new dedicated connection. Afterwards checks run on the
 * pool and accept NULL or '' (a non-empty leak or default is still caught: `SET LOCAL` reverts to the session value).
 *
 * Cadence: a passing result is reused for the interval (5 min); a failing one is never reused, so a fixed drift or a
 * transient start-up failure recovers on the next check. A monitor timer re-checks on the interval independently of
 * `/health/ready` polling (PR9-SEC-05). Drift makes the database component not ready and emits one security event
 * per finding and transition (`security.db_role_setting_drift`, `security.db_session_default_tampered`; WAVE-00
 * TASK-006, ADR-0005 am. 10).
 */

/**
 * Every `ALTER ROLE platform_app SET …` of the bootstrap lane, as `pg_db_role_setting.setconfig` entries: 00-roles.sql
 * (search_path, idle_in_transaction_session_timeout, lock_timeout) and 02-role-backstops.sql (statement_timeout 30 s
 * backstop, lc_messages = C so `mapDbError` reads PostgreSQL's English RLS message; D-ARCH-064, D-ARCH-073). The unit
 * test parses every bootstrap file, so a new role setting fails it until it is listed here (D-ORCH-014 (a)).
 */
export const EXPECTED_ROLE_SETTINGS: readonly string[] = Object.freeze(
  [
    'idle_in_transaction_session_timeout=15s',
    'lc_messages=C',
    'lock_timeout=2s',
    'search_path=pg_catalog, public',
    'statement_timeout=30s',
  ].sort(),
);

/** Tenant-context keys set per transaction by `withTenantTx` (ADR-0005); never a session or role default. */
export const TENANT_CONTEXT_KEYS = ['app.org_id', 'app.actor_id', 'app.actor_scope', 'app.guest_token_hash'] as const;

/** Re-check interval after start-up (readiness is polled every few seconds; the catalog query is cheap but not free). */
export const SESSION_INTEGRITY_INTERVAL_MS = 5 * 60_000;

/**
 * Role settings for `current_user` in this database or all databases, plus database-wide settings of this database,
 * and the session values of the tenant-context keys. Catalog reads only; no parameters.
 */
export const SESSION_INTEGRITY_SQL = `SELECT
  COALESCE((
    SELECT array_agg(cfg ORDER BY cfg)
      FROM pg_catalog.pg_db_role_setting s
      CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
     WHERE (s.setrole = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
            AND s.setdatabase IN (0, (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database())))
        OR (s.setrole = 0
            AND s.setdatabase = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database()))
  ), '{}'::text[]) AS settings,
  ARRAY[${TENANT_CONTEXT_KEYS.map((key) => `current_setting('${key}', true)`).join(', ')}] AS context`;

export type SessionIntegrityFinding = 'db_role_setting_drift' | 'db_session_default_tampered';

export interface SessionIntegrityRow {
  readonly settings: readonly string[];
  readonly context: readonly (string | null)[];
}

/** Pure evaluation of one probe row: the findings, never the values (they could be attacker-chosen). */
export function evaluateSessionIntegrity(
  row: SessionIntegrityRow,
  options: { readonly freshConnection?: boolean } = {},
): readonly SessionIntegrityFinding[] {
  const findings: SessionIntegrityFinding[] = [];
  const actual = [...row.settings].sort();
  const sameSettings = actual.length === EXPECTED_ROLE_SETTINGS.length && actual.every((entry, i) => entry === EXPECTED_ROLE_SETTINGS[i]);
  if (!sameSettings) findings.push('db_role_setting_drift');
  const unset = (value: string | null): boolean => value === null || (options.freshConnection !== true && value === '');
  if (!row.context.every(unset)) findings.push('db_session_default_tampered');
  return findings;
}

export interface IntegrityQueryable {
  query(text: string): Promise<{ readonly rows: readonly unknown[] }>;
}

/** A connection opened for one check and closed afterwards (never taken from the pool). */
export interface DedicatedConnection extends IntegrityQueryable {
  end(): Promise<void>;
}

export interface SessionIntegrityGuardOptions {
  /** The runtime pool; used once the dedicated start-up check has passed. */
  readonly pool: IntegrityQueryable;
  /** Opens a NEW connection with the pool's settings (`pg.Client` from the same validated config), for start-up. */
  readonly connectDedicated: () => Promise<DedicatedConnection>;
  /** Security event sink: called once per detection with the finding names only (each name is the event name). */
  readonly onDrift: (findings: readonly SessionIntegrityFinding[]) => void;
  readonly intervalMs?: number;
  readonly now?: () => number;
}

export interface SessionIntegrityGuard {
  /**
   * Readiness: resolves when the last evaluation found no drift; re-evaluates when no evaluation passed yet, when the
   * last one failed, or when the interval has elapsed. Rejects with `SessionIntegrityError` on drift.
   */
  assertIntact(): Promise<void>;
  /** Evaluates now, regardless of the interval (start-up and the monitor timer). Same result as `assertIntact`. */
  recheck(): Promise<void>;
}

const isRow = (value: unknown): value is SessionIntegrityRow =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { settings?: unknown }).settings) &&
  Array.isArray((value as { context?: unknown }).context);

export class SessionIntegrityError extends Error {
  constructor(readonly findings: readonly SessionIntegrityFinding[]) {
    super(`database session integrity: ${findings.join(', ')}`);
    this.name = 'SessionIntegrityError';
  }
}

async function probeRow(connection: IntegrityQueryable): Promise<SessionIntegrityRow> {
  const result = await connection.query(SESSION_INTEGRITY_SQL);
  const row = result.rows[0];
  if (!isRow(row)) throw new Error('session integrity probe returned no row');
  return row;
}

async function probeDedicated(connect: () => Promise<DedicatedConnection>): Promise<SessionIntegrityRow> {
  const connection = await connect();
  try {
    return await probeRow(connection);
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export function createSessionIntegrityGuard(options: SessionIntegrityGuardOptions): SessionIntegrityGuard {
  const intervalMs = options.intervalMs ?? SESSION_INTEGRITY_INTERVAL_MS;
  const now = options.now ?? Date.now;
  /** True once a dedicated-connection check found no tenant context (NULL); from then on the pool is used. */
  let startupPassed = false;
  /** Time of the last evaluation that found no drift; undefined after a failing or erroring one. */
  let passedAt: number | undefined;
  let findings: readonly SessionIntegrityFinding[] = [];
  let inflight: Promise<void> | undefined;

  const evaluate = async (): Promise<void> => {
    const dedicated = !startupPassed;
    passedAt = undefined;
    const row = dedicated ? await probeDedicated(options.connectDedicated) : await probeRow(options.pool);
    const next = evaluateSessionIntegrity(row, { freshConnection: dedicated });
    // One security event per transition into drift (or change of findings), not one per readiness poll.
    if (next.length > 0 && next.join() !== findings.join()) options.onDrift(next);
    findings = next;
    if (next.length > 0) return;
    startupPassed = true;
    passedAt = now();
  };

  // Concurrent callers (readiness, monitor) share one evaluation.
  const refresh = (): Promise<void> => {
    inflight ??= evaluate().finally(() => {
      inflight = undefined;
    });
    return inflight;
  };

  const result = (): void => {
    if (findings.length > 0) throw new SessionIntegrityError(findings);
  };

  return {
    async assertIntact(): Promise<void> {
      if (passedAt === undefined || now() - passedAt >= intervalMs) await refresh();
      result();
    },
    async recheck(): Promise<void> {
      await refresh();
      result();
    },
  };
}

export interface IntegrityMonitor {
  readonly name: 'session-integrity-monitor';
  /** Stops the timer (graceful shutdown); in-flight checks finish on their own. */
  close(): Promise<void>;
}

/**
 * PR9-SEC-05: re-checks on a timer, independent of `/health/ready` polling (ECS polls liveness only), so durable
 * tampering raises its security event within one interval. The timer is unref'd: it never keeps the process alive.
 * Failures are already reported through `onDrift` or the next readiness check; nothing is thrown from the timer.
 */
export function startIntegrityMonitor(guard: SessionIntegrityGuard, intervalMs: number = SESSION_INTEGRITY_INTERVAL_MS): IntegrityMonitor {
  const timer = setInterval(() => {
    guard.recheck().catch(() => undefined);
  }, intervalMs);
  timer.unref();
  return {
    name: 'session-integrity-monitor',
    close: () => {
      clearInterval(timer);
      return Promise.resolve();
    },
  };
}
