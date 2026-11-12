/**
 * Session-integrity guard of the runtime role (PR7-SEC-06 item 3, PR7-SEC-02 item 2; D-ORCH-011). Two persistent
 * tampering paths would silently weaken every new connection of the pool:
 *  - `platform_app` may `ALTER ROLE platform_app SET|RESET` its own USERSET defaults (`lock_timeout`,
 *    `idle_in_transaction_session_timeout`, `search_path`, `statement_timeout`, `default_transaction_read_only`),
 *    which then apply to every API and worker task and survive restarts;
 *  - a session default for a tenant-context key (`app.org_id`, ...) would pre-set RLS context on fresh connections.
 * The guard compares the role and database-level settings that apply to `current_user` with the exact expected set
 * from `prisma/bootstrap/00-roles.sql`, and requires every tenant-context key to be unset. The start-up probe (the
 * first readiness check, on a fresh pool connection) requires NULL; later probes may meet a pooled connection where a
 * transaction-local `set_config` left '' behind, so they accept NULL or ''. It then re-checks at most once per
 * interval; drift makes the database component not ready and emits one security event per finding
 * (`security.db_role_setting_drift`, `security.db_session_default_tampered`; WAVE-00 TASK-006, ADR-0005 am. 10).
 */

/** `ALTER ROLE platform_app SET …` in prisma/bootstrap/00-roles.sql, as `pg_db_role_setting.setconfig` entries. */
export const EXPECTED_ROLE_SETTINGS: readonly string[] = Object.freeze(
  ['idle_in_transaction_session_timeout=15s', 'lock_timeout=2s', 'search_path=pg_catalog, public'].sort(),
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

export interface SessionIntegrityGuardOptions {
  readonly pool: IntegrityQueryable;
  /** Security event sink: called once per detection with the finding names only (each name is the event name). */
  readonly onDrift: (findings: readonly SessionIntegrityFinding[]) => void;
  readonly intervalMs?: number;
  readonly now?: () => number;
}

export interface SessionIntegrityGuard {
  /** Resolves when the last evaluation (refreshed when due) found no drift; rejects otherwise. */
  assertIntact(): Promise<void>;
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

export function createSessionIntegrityGuard(options: SessionIntegrityGuardOptions): SessionIntegrityGuard {
  const intervalMs = options.intervalMs ?? SESSION_INTEGRITY_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let checkedAt: number | undefined;
  let findings: readonly SessionIntegrityFinding[] = [];

  const refresh = async (): Promise<void> => {
    const result = await options.pool.query(SESSION_INTEGRITY_SQL);
    const row = result.rows[0];
    if (!isRow(row)) throw new Error('session integrity probe returned no row');
    const next = evaluateSessionIntegrity(row, { freshConnection: checkedAt === undefined });
    // One security event per transition into drift (or change of findings), not one per readiness poll.
    if (next.length > 0 && next.join() !== findings.join()) options.onDrift(next);
    findings = next;
    checkedAt = now();
  };

  return {
    async assertIntact(): Promise<void> {
      if (checkedAt === undefined || now() - checkedAt >= intervalMs) await refresh();
      if (findings.length > 0) throw new SessionIntegrityError(findings);
    },
  };
}
