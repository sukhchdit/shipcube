/**
 * Per-table and per-route inputs of the RLS generator (TASK-024) that the catalogue cannot supply. Both maps start
 * empty: a new table is covered by the generic row synthesis, and a new tenant-resource route FAILS the suite until
 * it registers its executable API case here (AT-US-077-02/-03; there is no skip list).
 *
 * - `ROW_OVERRIDES`: column values the synthesis cannot derive (a CHECK other than a single-column enum list, a
 *   pattern, a domain), keyed by table then column. Never secrets or personal data: synthetic values only.
 * - `API_CASES`: operationId -> `ApiCrossTenantCase` for every `tenant`/`user`/`guest` route with a path parameter
 *   (TASK-027 and the module tasks add theirs with the route; TASK-051 the quote routes; TASK-211 the account routes).
 *   `cross-tenant.int.test.ts` executes every entry against the real module registry (B's id -> 404 `NOT_FOUND`
 *   without B data, A's id -> the positive status; per credential kind the route accepts). An entry is a request
 *   description, never a bare operationId: registering a route always runs its case (PR43-SEC-01, R1-M2).
 */
import type { ApiCrossTenantCase } from './generator.js';

/**
 * `CUSTOMER_VIEWER` as seeded by the released, hash-pinned authz seed migration `20261112010100_authz_seed_v1`
 * (`seedId('role', 'CUSTOMER_VIEWER')`, tools/authz/generate.ts), present in every migrated template. Its scope
 * CUSTOMER matches the BUSINESS_CUSTOMER organisations below, so `platform.role_scope_matches_org()` passes on A's own
 * rows. generator.test.ts pins the literal against the migration text (D-TASK037-15).
 */
export const CUSTOMER_VIEWER_ROLE_ID = '01a1cd0d-dc00-7de9-b7f0-012e714f500c';

export const ROW_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // D-ARCH-151: the one OPERATOR organisation is the reserved row of the migration and occupies
  // ux_organisations__single_operator, so no fixture plants another (the first enum value of ck_organisations__type
  // would be OPERATOR). BUSINESS_CUSTOMER also satisfies ck_organisations__personal_owner without an owner.
  organisations: { type: 'BUSINESS_CUSTOMER' },
  // The first enum value is the reserved INVITED, which no code writes (D-ARCH-123); seed the live status instead.
  memberships: { status: 'ACTIVE' },
  // A real role whose scope matches the organisation type, so the role-scope guard is not tripped by fixture data.
  membership_roles: { role_id: CUSTOMER_VIEWER_ROLE_ID },
  invitations: { role_id: CUSTOMER_VIEWER_ROLE_ID },
};

/**
 * Tables guarded by `platform.role_scope_matches_org()`, keyed by table name, valued by the trigger that installs it.
 * The guard fires BEFORE INSERT OR UPDATE OF role_id, org_id, ahead of WITH CHECK (see `CaseTraits.roleScopeGuard`).
 * cross-tenant.int.test.ts fails when a listed trigger is not live, so the expectation cannot go stale silently, and a
 * newly guarded table that is missing here fails its `insert-foreign-key` / `reparent-own-row` cases (D-TASK037-14).
 */
export const ROLE_SCOPE_GUARDS: Readonly<Record<string, string>> = {
  invitations: 'trg_invitations__role_scope',
  membership_roles: 'trg_membership_roles__scope_matches_org',
};

export const API_CASES: ReadonlyMap<string, ApiCrossTenantCase> = new Map<string, ApiCrossTenantCase>();
