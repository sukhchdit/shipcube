/**
 * Seed framework contracts (TASK-023, US-049; data-model §9.1-§9.3, REQ-DATA-001/002). The reference seed runs in
 * every environment as `platform_migrator`; the demo seed runs only outside production. Both are idempotent: they
 * upsert by natural key, write nothing when the database already holds the seeded values, and never print a seed
 * password.
 *
 * The reference seed never writes `permissions`, `roles` or `role_permissions`: the generated authz seed migration
 * is their only writer (D-ARCH-060). The reference seed only verifies parity with `packages/authz`.
 */
import type { AppEnv, Secret } from '@platform/config';

/** Provenance of a seeded row (DR-A27, REQ-COMP-004). */
export type SeedSource = 'ISO' | 'SEED' | 'SAMPLE';

/** Scalar column values a dataset row may carry. Arrays map to PostgreSQL arrays, plain objects to jsonb. */
export type SeedValue = string | number | boolean | null | Date | readonly string[] | { readonly [key: string]: unknown };

/** One row of a dataset: column name → value. Every row carries `source`. */
export type SeedRow = Readonly<Record<string, SeedValue>> & { readonly source: SeedSource };

/**
 * A reference dataset: a fixed set of rows for one table, upserted by natural key.
 * - `name` is the `reference_dataset_versions.dataset` key (e.g. `countries`, `compliance_pack:IN`).
 * - `insertOnly` datasets (published versions: FX snapshots, packs, pricing versions, templates) never update an
 *   existing natural key; a content change for an existing key fails the seed (data-model §9.1).
 * - `audited` datasets (configuration: packs, pricing versions, templates, flags) report each version change to the
 *   {@link ConfigChangeSink}, and so is every drift restoration of their rows; an unchanged dataset never does
 *   (REQ-COMP-008 "none on a no-op re-run").
 *
 * Contract limits (code review PR #13 m4). A dataset that needs one of these cannot be expressed yet; the extension
 * lands, with tests, in the first task that seeds such a table (see prisma/README.md "Dataset contract limits"):
 * - no UUID foreign keys: `id` is runner-owned and there is no natural-key → id lookup or deterministic `seedId`;
 * - no null natural-key value: `NULLS NOT DISTINCT` keys (e.g. `holidays.region_code`) are refused;
 * - no partial-index arbiter: `ON CONFLICT (naturalKey)` cannot infer a `UNIQUE … WHERE …` index;
 * - no insert-only columns: every listed column is restored on drift.
 * HARD RULE: never list a column that the runtime or a reviewer mutates (`number_sequences.next_value`,
 * `reviewed_at`, `reviewed_by`, counters, statuses): the next seed run would reset it.
 */
export interface Dataset {
  readonly name: string;
  readonly version: string;
  /** Schema-qualified table, e.g. `public.countries`. Validated against `^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$`. */
  readonly table: string;
  readonly naturalKey: readonly string[];
  /** Columns written on insert and compared/updated on drift; must include every natural-key column and `source`. */
  readonly columns: readonly string[];
  readonly rows: readonly SeedRow[];
  readonly insertOnly?: boolean;
  readonly audited?: boolean;
}

/** Outcome of one dataset. `unchanged` means zero rows written and no version row touched. */
export interface DatasetResult {
  readonly dataset: string;
  readonly status: 'unchanged' | 'applied';
  readonly inserted: number;
  /** Rows whose seeded columns had drifted and were restored (AT-US-049-08). */
  readonly updated: number;
  readonly rowCount: number;
  /** Lower-case hex SHA-256 of the canonical dataset content. */
  readonly contentSha256: string;
}

/** The `reference_dataset_versions` row of one dataset (data-model §3.5). */
export interface DatasetVersion {
  readonly dataset: string;
  readonly version: string;
  readonly contentSha256: string;
  readonly rowCount: number;
  readonly appliedAt: Date;
}

/**
 * Minimal SQL surface the seed needs; implemented by ONE dedicated `pg` client connected as `platform_migrator`.
 * A `pg.Pool` is refused (by type here, and at run time by `runReferenceSeed`): with a pool, `BEGIN`, the advisory
 * lock and `COMMIT` would run on different connections and a refused run would leave partial writes (code review n3).
 */
export interface SeedSql {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: R[]; readonly rowCount: number | null }>;
  /** Present on `pg.Pool` only. */
  readonly totalCount?: never;
  /** Present on `pg.Pool` only. */
  readonly idleCount?: never;
}

/**
 * The `reference_dataset_versions` hook: the dataset runner uses it for the no-op check. The seed, connected as
 * `platform_migrator` (the table owner), is the table's single writer; `platform_app` holds `SELECT` only. TASK-221's
 * reconciler (US-073) shares the table, not this object: it reads the rows and derives the last audited digest from
 * `audit_entries` (data-model §3.5, D-ARCH-075).
 */
export interface DatasetVersionStore {
  get(sql: SeedSql, dataset: string): Promise<DatasetVersion | undefined>;
  /** Insert or update the row for `dataset` (actor = SYSTEM actor). */
  record(sql: SeedSql, version: Omit<DatasetVersion, 'appliedAt'>): Promise<void>;
}

/**
 * A configuration change produced by a seed run (one `CONFIG_CHANGE` audit entry each; REQ-RBAC-013, REQ-COMP-008,
 * data-model §9.1):
 * - `version`: an audited dataset's version label or content hash changed (first seed included);
 * - `drift-restored`: the label and hash are unchanged, but `restoredRows` rows had been edited or deleted in the
 *   database and were restored to the seeded values, by update or by re-insert (code review PR #13 m5 and R2-m1,
 *   PR13-SEC-06). Never emitted for a no-op run.
 */
export type ConfigChange =
  | {
      readonly kind: 'version';
      readonly dataset: string;
      readonly fromVersion: string | undefined;
      readonly toVersion: string;
      readonly fromSha256: string | undefined;
      readonly toSha256: string;
    }
  | {
      readonly kind: 'drift-restored';
      readonly dataset: string;
      readonly version: string;
      readonly sha256: string;
      readonly restoredRows: number;
    };

/** Receives configuration changes inside the seed transaction. The audit writer (TASK-025) implements it. */
export interface ConfigChangeSink {
  configChanged(sql: SeedSql, change: ConfigChange): Promise<void>;
}

/** Structured seed log. Fields never carry secret values; keys are variable or dataset names only. */
export interface SeedLogger {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  warn(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

/** A non-dataset step of the reference seed (e.g. the authz parity check, audit partition pre-creation). */
export interface SeedStep {
  readonly name: string;
  run(context: SeedContext): Promise<void>;
}

export interface SeedContext {
  readonly sql: SeedSql;
  readonly logger: SeedLogger;
  readonly versions: DatasetVersionStore;
  readonly configChanges: ConfigChangeSink;
}

/** The `SEED_*` password variables of the demo seed (packages/config schema, D-022). */
export const SEED_PASSWORD_VARIABLES = ['SEED_SUPERADMIN_PASSWORD', 'SEED_CUSTOMER_PASSWORD'] as const;
export type SeedPasswordVariable = (typeof SEED_PASSWORD_VARIABLES)[number];

/**
 * How the demo seed provisions credentials (REQ-DATA-002, D-043, D-052, SEC-P3-14), decided before any write:
 * - `skip`: APP_ENV=production; the demo seed writes nothing (AT-US-049-03).
 * In staging and production any SEED_* password variable that is present is refused (SEED_DEFAULT_PASSWORD_REFUSED for a
 * `local-only-*` default, SEED_PASSWORD_FORBIDDEN otherwise), naming the variable only.
 * - `seeded-passwords`: APP_ENV ∈ {local, test}; every SEED_* variable is required; `local-only-*` defaults are
 *   accepted only in `local` (AT-US-049-04/-05/-06/-10).
 * - `set-password-link`: any other non-production APP_ENV (staging); no SEED_* password is read; staff users get no
 *   credential and a SET_PASSWORD reset link instead (AT-US-049-09).
 */
export type DemoCredentialPlan =
  | { readonly kind: 'skip'; readonly reason: 'production' }
  | { readonly kind: 'seeded-passwords'; readonly passwords: ReadonlyMap<SeedPasswordVariable, Secret<string>> }
  | { readonly kind: 'set-password-link' };

export type SeedRefusalCode =
  | 'SEED_DEFAULT_PASSWORD_REFUSED'
  | 'SEED_VARIABLE_MISSING'
  | 'SEED_PASSWORD_FORBIDDEN'
  | 'SEED_ENVIRONMENT_INVALID'
  | 'SEED_INSERT_ONLY_CHANGED'
  | 'SEED_AUTHZ_DRIFT'
  | 'SEED_INVALID_DATASET';

/** A refusal raised before or instead of writing. The message names variables or datasets only, never values. */
export class SeedRefusedError extends Error {
  readonly code: SeedRefusalCode;
  /** Variable or dataset names the refusal is about. */
  readonly subjects: readonly string[];

  constructor(code: SeedRefusalCode, subjects: readonly string[], message: string) {
    super(message);
    this.name = 'SeedRefusedError';
    this.code = code;
    this.subjects = Object.freeze([...subjects]);
  }
}

/** A demo user the demo seed ensures exists (data-model §9.3). Users arrive with TASK-089 (identity service). */
export interface DemoUserSpec {
  readonly email: string;
  /** Operator staff get a set-password link outside local/test; customers follow the same plan. */
  readonly kind: 'staff' | 'customer';
  readonly passwordVariable: SeedPasswordVariable;
}

export type DemoCredential = { readonly kind: 'password'; readonly password: Secret<string> } | { readonly kind: 'set-password-link' };

/**
 * Port to the identity service (TASK-037/TASK-089): creates the user, memberships, roles, audit entries and outbox
 * events exactly as production does, or finds it by email and changes nothing.
 */
/** `deferred`: no identity-backed provisioner is wired yet (TASK-089); nothing was written. */
export type DemoUserOutcome = 'created' | 'unchanged' | 'deferred';

export interface DemoUserProvisioner {
  ensureUser(spec: DemoUserSpec, credential: DemoCredential): Promise<DemoUserOutcome>;
}

export interface DemoSeedOptions {
  readonly appEnv: AppEnv;
  readonly users: readonly DemoUserSpec[];
  readonly provisioner: DemoUserProvisioner;
  readonly logger: SeedLogger;
}
